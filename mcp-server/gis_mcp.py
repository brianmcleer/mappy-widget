"""
gis_mcp.py - an in-house MCP server (Model Context Protocol) for ArcGIS services.

Gives assistants such as Mappy (and desktop AI tools) read-only tools over your own
ArcGIS Enterprise services:

    geocode          find an address with your own locator
    reverse_geocode  the address at a point
    identify         what is at a point (parcel, zoning, flood zone...)
    find_features    search a layer by name, address or id
    count_features   how many features a layer has (optionally matching text)
    list_layers      the layers it can search
    search_content   find maps, apps and layers in Portal
    (plus tools passed through from other MCP servers listed in upstream_servers, such as
     Esri's ArcGIS Location Services MCP or ArcGIS Enterprise's own MCP, with a name prefix)

No service account: each request carries the signed-in user's own ArcGIS token
(Authorization: Bearer ...), which is passed to the services, so people only ever see
what Portal already lets them see. Requests without a token reach public services only
(or are refused when require_token is set).

Read-only by construction: it only calls query, geocode and search endpoints, and only
for the layers and locator named in config.json (no other URLs can be reached).

Transport: MCP Streamable HTTP (protocol 2025-06-18, also 2025-03-26 and 2024-11-05),
stateless, JSON responses. Also runs over stdio for desktop clients (--stdio).

Run:
    python gis_mcp.py --config config.json --port 8808          (testing)
    IIS HttpPlatformHandler with web.config                       (production)
    python gis_mcp.py --config config.json --stdio                (desktop clients)

Needs Python 3.9+ and Flask (ArcGIS Pro's Python has both). Waitress is used when
installed.

Changelog
    1.5.0 (2026-10-28) Ready for Esri's MCP servers: upstream_servers passes through tools from other
                       MCP servers (ArcGIS Location Services MCP now; ArcGIS Enterprise/Online MCP when
                       they ship) behind this one server. API keys stay on the server (environment
                       variable); signed-in users' tokens go only to servers in the Portal's domain;
                       tools that could change data are hidden unless allow_write; names get a prefix.
                       Sessions per identity, renewed when they expire; tool lists cached; JSON or
                       event-stream answers; paged tool lists. MCP 2025-11-25 accepted. Optional OAuth
                       protected-resource metadata (oauth_authorization_servers) for MCP clients that
                       sign in on their own. /health lists upstream status.
    1.0.1 (2026-10-27) Folders that need a sign-in are read again on the first signed-in request
                       (instead of after refresh_minutes).
    1.0.0 (2026-10-27) First release.
"""
import argparse
import json
import logging
import math
import os
import re
import ssl
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from logging.handlers import TimedRotatingFileHandler

VERSION = '1.6.0'
SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0]

DEFAULTS = {
    'name': 'City GIS',
    'instructions': 'Read-only tools over the city GIS: addresses, what is at a place, the closest feature, features within a distance, searching and summarizing layers, and finding maps.',
    'allowed_origins': [],
    'portal_url': '',
    'locator_url': '',
    'locator_single_line_field': 'SingleLine',
    'require_token': False,
    'max_results': 25,
    'timeout_seconds': 20,
    'verify_tls': True,
    'service_folders': [],
    'layers': [],
    'identify_max_layers': 25,
    'identify_point_tolerance_feet': 25,
    'refresh_minutes': 60,
    'log_dir': 'logs',
    'log_days': 30
}

SYSTEM_FIELDS = re.compile(r'^(objectid|fid|oid|shape|shape_length|shape_area|shape\.starea\(\)|shape\.stlength\(\)|st_area\(shape\)|st_length\(shape\)|globalid|created_user|created_date|last_edited_user|last_edited_date|gdb_.*)$', re.I)
TOKEN_SHAPE = re.compile(r'^[A-Za-z0-9._\-~+/=]{10,4096}$')
log = logging.getLogger('gis_mcp')


class ToolError(Exception):
    """A problem to report to the person (the tool result has isError: true). The message is
    written for people and carries no internals; `said` is what the client gets."""

    def __init__(self, said):
        super().__init__(said)
        self.said = str(said)


class RpcError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- config

def load_config(path):
    cfg = dict(DEFAULTS)
    if path:
        with open(path, 'r', encoding='utf-8-sig') as f:
            cfg.update(json.load(f))
    cfg['allowed_origins'] = [o.rstrip('/') for o in cfg.get('allowed_origins') or []]
    cfg['max_results'] = max(1, min(100, int(cfg.get('max_results') or 25)))
    for key in ('portal_url', 'locator_url'):
        cfg[key] = (cfg.get(key) or '').rstrip('/')
    return cfg


def setup_logging(cfg, base_dir):
    log.setLevel(logging.INFO)
    if log.handlers:
        return
    folder = cfg.get('log_dir') or 'logs'
    if not os.path.isabs(folder):
        folder = os.path.join(base_dir, folder)
    try:
        os.makedirs(folder, exist_ok=True)
        handler = TimedRotatingFileHandler(os.path.join(folder, 'gis_mcp.log'), when='midnight', backupCount=int(cfg.get('log_days') or 30), encoding='utf-8')
    except OSError:
        handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    log.addHandler(handler)


# ---------------------------------------------------------------- ArcGIS REST

class ArcGIS:
    """Calls ArcGIS REST endpoints with the caller's token. Only URLs in config are ever called."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.timeout = float(cfg.get('timeout_seconds') or 20)
        self.ctx = None if cfg.get('verify_tls', True) else ssl._create_unverified_context()

    def get(self, url, params, token=None, referer=None):
        query = dict(params)
        query['f'] = 'json'
        if token:
            query['token'] = token
        data = urllib.parse.urlencode(query).encode('utf-8')
        # POST keeps long where clauses and tokens out of server logs and URL limits.
        req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gis-mcp/' + VERSION})
        if referer:
            req.add_header('Referer', referer)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as res:
                body = res.read(20_000_000)
        except urllib.error.HTTPError as e:
            raise ToolError('The GIS server answered %s.' % e.code)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log.warning('GIS server unreachable: %s', getattr(e, 'reason', e))
            raise ToolError('Could not reach the GIS server.')
        try:
            out = json.loads(body.decode('utf-8', 'replace'))
        except ValueError:
            raise ToolError('The GIS server sent an answer that is not JSON.')
        if isinstance(out, dict) and out.get('error'):
            err = out['error']
            code = err.get('code')
            if code == 498 and token:
                # A server not federated with this Portal (a public locator, say) rejects the
                # Portal token outright; public data still answers without one.
                return self.get(url, params, None, referer)
            if code in (498, 499, 401, 403):
                raise ToolError('You need to sign in, or your account cannot see this data (%s).' % code)
            raise ToolError('The GIS server said: %s' % (err.get('message') or code))
        return out


# ---------------------------------------------------------------- layers

class Layers:
    """The layers tools may search: listed in config, plus every layer in the listed service folders."""

    def __init__(self, cfg, gis):
        self.cfg = cfg
        self.gis = gis
        self.lock = threading.Lock()
        # One folder read at a time; requests meanwhile use the names already known.
        self.reading = threading.Lock()
        self.by_name = {}
        self.meta = {}
        self.loaded_at = 0
        self.notes = []
        self.read_signed_in = False
        self.tried_at = 0.0

    def refresh(self, token=None, force=False, referer=None):
        stale = time.time() - self.loaded_at > float(self.cfg.get('refresh_minutes') or 60) * 60
        # Names read without a sign-in can miss secured services (a folder lists only what the
        # caller may see), so the first signed-in request reads them again, at most twice a minute.
        retry = bool(token and not self.read_signed_in and time.time() - self.tried_at > 30)
        if not force and self.by_name and not stale and not retry:
            return
        if self.by_name and not force:
            # Known names keep answering while one background read brings them up to date.
            if self.reading.acquire(blocking=False):
                self.tried_at = time.time()
                def run():
                    try:
                        self._read(token, referer)
                    except Exception:
                        log.exception('Layer refresh failed')
                    finally:
                        self.reading.release()
                threading.Thread(target=run, daemon=True).start()
            return
        # Nothing known yet: read now, once; requests arriving meanwhile wait for that read.
        with self.reading:
            if self.by_name and not force:
                return
            self._read(token, referer)

    def _read(self, token=None, referer=None):
        # Layer names come from whoever asks (or discovery_token): names only. Every query
        # still runs with the asking person's own token, so data stays behind Portal sharing.
        token = token or self.cfg.get('discovery_token') or None
        found = {}
        meta = {}
        notes = []
        for item in self.cfg.get('layers') or []:
            url = (item.get('url') or '').rstrip('/')
            if not re.search(r'/(MapServer|FeatureServer)/\d+$', url):
                notes.append('Skipped a layer without a MapServer/FeatureServer layer URL: %s' % url)
                continue
            name = (item.get('name') or url.rsplit('/', 2)[-2]).strip()
            found[name.lower()] = dict(item, name=name, url=url, path=item.get('path') or name)
        services = []
        for folder in self.cfg.get('service_folders') or []:
            services.extend(self._services(folder.rstrip('/'), token, notes, referer=referer))
        # A service published as both MapServer and FeatureServer: use the MapServer copy only.
        map_names = {name for name, kind, base in services if kind == 'MapServer'}
        seen = set()
        for name, kind, base in services:
            if (kind == 'FeatureServer' and name in map_names) or base in seen:
                continue
            seen.add(base)
            try:
                info = self.gis.get(base + '/layers', {}, token, referer)
            except ToolError as e:
                notes.append('Could not read %s: %s' % (base, e))
                continue
            svc_label = name.split('/')[-1].replace('_', ' ')
            for lyr, path in layer_paths(info):
                name_ = (lyr.get('name') or '').strip()
                url = '%s/%s' % (base, lyr.get('id'))
                entry = {'name': name_, 'url': url, 'from_folder': True, 'path': ' > '.join([svc_label] + path + [name_]),
                         'groups': path, 'service': svc_label}
                meta[url] = lyr
                key = name_.lower()
                if key in found:
                    # Same name twice ("Manholes" under Storm and under Sanitary): name both by
                    # their nearest group or service, so each can be asked for.
                    other = found.pop(key)
                    for e in (other, dict(entry, base_name=name_)):
                        self._add_distinct(found, e)
                    continue
                if any(v.get('base_name', v['name']).lower() == key for v in found.values()):
                    self._add_distinct(found, dict(entry, base_name=name_))
                    continue
                found[key] = dict(entry, base_name=name_)
        with self.lock:
            if not token and self.read_signed_in:
                # A timed re-read without a sign-in sees less (secured folders are hidden); keep
                # the names a signed-in read found and add anything new, instead of losing them.
                kept = dict(self.by_name)
                kept.update(found)
                found = kept
            self.by_name = found
            self.meta.update(meta)
            self.loaded_at = time.time()
            self.notes = notes
            if token:
                self.tried_at = time.time()
                self.read_signed_in = not any('sign in' in n for n in notes)
        for n in notes:
            log.warning(n)
        # Learn every layer word once now, so the first question is not the slow one.
        try:
            for v in found.values():
                for w in layer_words(' '.join([v.get('path') or '', v['name']])):
                    fix_word(w)
        except Exception:
            pass

    @staticmethod
    def _add_distinct(found, e):
        base = e.get('base_name') or e['name']
        label = distinct_name(dict(e, base_name=base))
        if label.lower() in found:
            label = ' - '.join([e.get('service') or 'Layer'] + (e.get('groups') or []) + [base])
        n = 2
        while label.lower() in found:
            label = '%s (%d)' % (label.split(' (')[0], n)
            n += 1
        found[label.lower()] = dict(e, name=label, base_name=base)

    def _services(self, folder, token, notes, depth=0, referer=None):
        """(name, type, url) of every map and feature service in a folder; the services root
        lists its folders too, so "https://server/arcgis/rest/services" reads everything."""
        try:
            listing = self.gis.get(folder, {}, token, referer)
        except ToolError as e:
            notes.append('Could not read %s: %s' % (folder, e))
            return []
        root = folder.split('/rest/services')[0] + '/rest/services'
        out = [(svc.get('name') or '', svc.get('type'), '%s/%s/%s' % (root, svc.get('name'), svc.get('type')))
               for svc in listing.get('services') or [] if svc.get('type') in ('MapServer', 'FeatureServer')]
        if depth == 0 and folder.rstrip('/').endswith('/rest/services'):
            for sub in listing.get('folders') or []:
                if sub.lower() in {x.lower() for x in (self.cfg.get('skip_folders') or ['System'])}:
                    continue
                out.extend(self._services('%s/%s' % (root, sub), token, notes, depth + 1, referer))
        return out

    def names(self):
        return sorted(v['name'] for v in self.by_name.values())

    def find(self, name):
        if not name:
            return None
        key = str(name).strip().lower()
        hit = self.by_name.get(key)
        if hit:
            return hit
        # Forgiving: "hydrants" finds "Fire Hydrants"; "parcel" finds "Parcels".
        for v in self.by_name.values():
            n = v['name'].lower()
            if key in n or n in key or key.rstrip('s') == n.rstrip('s'):
                return v
        ranked = self.resolve(key)
        return ranked[0][1] if ranked else None

    def resolve(self, text):
        """Layers for plain words, best first: "sewer lien" -> Sewer Mains (synonyms, typos, line/point hints)."""
        words = layer_words(text)
        if not words:
            return []
        want = geometry_hint(words)
        out = []
        for v in self.by_name.values():
            meta = self.meta.get(v['url']) or {}
            # The groups and service above it count too: "Sewer > Mains" is a sewer main.
            svc = re.search(r'/rest/services/(?:[^/]+/)*?([^/]+)/(?:MapServer|FeatureServer)/', v['url'])
            name_words = layer_words(v['name'])
            # Group and service words count for less: every layer in "Property Information"
            # is not a property layer.
            context = layer_words(' '.join([v.get('path') or '', svc.group(1).replace('_', ' ') if svc else '']))
            own = layer_words(v.get('base_name') or v['name'])
            if not own:
                continue
            total = 0.0
            for w in words:
                total += max([word_match(w, n) for n in name_words] + [0.6 * word_match(w, n) for n in context] + [0])
            s = m = total / len(words)
            # Covering the layer's own name matters too ("sewer" alone is closer to "Sewer" than "Sewer Laterals").
            cover = sum(1 for n in own if max(word_match(w, n) for w in words) >= 0.8) / len(own)
            s += 0.2 * cover
            g = meta.get('geometryType')
            # Most of the words must fit; line, point or area words only break ties after that.
            if m < 0.55 or s < 0.6:
                continue
            if want and g:
                s += 0.3 if g == want else -0.2
            if s >= 0.6:
                out.append((round(s, 3), v, (round(m, 3), want == g if want and g else None)))
        out.sort(key=lambda x: (-x[0], x[1]['name']))
        # (score, layer, (how well the words matched, right kind of geometry)) best first.
        return out

    def info(self, layer, token=None, referer=None):
        """Layer metadata (fields, geometry type, display field), cached."""
        url = layer['url']
        meta = self.meta.get(url)
        if not meta or 'fields' not in meta:
            meta = self.gis.get(url, {}, token, referer)
            self.meta[url] = meta
        return meta

    def search_fields(self, layer, meta):
        listed = layer.get('search_fields')
        fields = meta.get('fields') or []
        strings = [f['name'] for f in fields if f.get('type') == 'esriFieldTypeString' and not SYSTEM_FIELDS.match(f['name'])]
        if listed:
            known = {f['name'].lower(): f['name'] for f in fields}
            return [known[x.lower()] for x in listed if x.lower() in known][:8]
        display = meta.get('displayField')
        ordered = ([display] if display in strings else []) + [s for s in strings if s != display]
        return ordered[:6]

    def show_fields(self, layer, meta):
        listed = layer.get('fields')
        fields = [f for f in (meta.get('fields') or []) if not SYSTEM_FIELDS.match(f['name']) and f.get('type') not in ('esriFieldTypeGeometry', 'esriFieldTypeBlob', 'esriFieldTypeRaster')]
        if listed:
            known = {f['name'].lower(): f for f in fields}
            return [known[x.lower()] for x in listed if x.lower() in known][:10]
        display = meta.get('displayField')
        # The fields people ask about first: owner, address, parcel number, zoning, acres.
        key = re.compile(r'own|situs|addr|parcel|pin|apn|zon|acre|name|class|use|type|status', re.I)
        order = {id(f): i for i, f in enumerate(fields)}
        fields.sort(key=lambda f: (0 if f['name'] == display else 1 if key.search(f['name'] + ' ' + (f.get('alias') or '')) else 2, order[id(f)]))
        return fields[:12]


def layer_paths(info):
    """Every feature layer and table in a service's /layers answer with the groups above it,
    outermost first, at any depth: [(layer, ['Utilities', 'Storm'])]. Group layers themselves
    (and subtype group parents) are left out; their children are listed."""
    layers = info.get('layers') or []
    by_id = {l.get('id'): l for l in layers}
    out = []
    for lyr in layers + (info.get('tables') or []):
        if lyr.get('subLayers') or lyr.get('type') not in ('Feature Layer', 'Table') or not (lyr.get('name') or '').strip():
            continue
        groups = []
        parent = (lyr.get('parentLayer') or {}).get('id')
        guard = 0
        while parent is not None and parent != -1 and parent in by_id and guard < 20:
            groups.insert(0, (by_id[parent].get('name') or '').strip())
            parent = (by_id[parent].get('parentLayer') or {}).get('id')
            guard += 1
        out.append((lyr, [g for g in groups if g]))
    return out


def distinct_name(entry):
    """A layer name that tells two same-named layers apart: its nearest group, else its service."""
    base = entry.get('base_name') or entry['name']
    groups = entry.get('groups') or []
    if groups and groups[-1].lower() != base.lower():
        return '%s - %s' % (groups[-1], base)
    return '%s - %s' % (entry.get('service') or 'Layer', base)


# ---------------------------------------------------------------- helpers

def clean_text(value, limit=200):
    s = re.sub(r'[\x00-\x1f\x7f]+', ' ', str(value or '')).strip()
    return s[:limit]


def number(value, name, low, high):
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ToolError('%s must be a number.' % name)
    if math.isnan(n) or n < low or n > high:
        raise ToolError('%s must be between %s and %s.' % (name, low, high))
    return n


def sql_text(s):
    return s.replace("'", "''")


QUERY_OPS = ('=', '!=', '>', '>=', '<', '<=', 'contains', 'starts_with', 'in', 'not_in', 'between', 'is_null', 'not_null', 'in_last_days')
FIELD_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_.]*$')


def field_kind(field):
    """text, number, date or other, for assistants choosing filters."""
    t = field.get('type') or ''
    if t in ('esriFieldTypeString', 'esriFieldTypeGUID', 'esriFieldTypeGlobalID'):
        return 'text'
    if t in ('esriFieldTypeSmallInteger', 'esriFieldTypeInteger', 'esriFieldTypeSingle', 'esriFieldTypeDouble', 'esriFieldTypeOID', 'esriFieldTypeBigInteger'):
        return 'number'
    if t in ('esriFieldTypeDate', 'esriFieldTypeDateOnly', 'esriFieldTypeTimestampOffset'):
        return 'date'
    return 'other'


def parse_day(value):
    """A date from YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, M/D/YYYY or a year; ToolError otherwise."""
    s = clean_text(value, 40)
    for fmt in ('%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%m/%d/%Y', '%Y'):
        try:
            d = datetime.strptime(s.rstrip('Z'), fmt)
            if 1000 <= d.year <= 2999:
                return d
        except ValueError:
            pass
    raise ToolError('"%s" is not a date. Use YYYY-MM-DD.' % s)


# -- plain words for layers ("sewer line" -> Sewer Mains)

SYNONYMS = [
    'line main pipe pipeline conduit gravity forcemain',
    'sewer sanitary wastewater ss',
    'storm stormwater drainage drain',
    'water potable domestic waterline',
    'hydrant fh',
    'manhole mh',
    'parcel lot property tax',
    'zoning zone zoned district',
    'street road centerline roadway',
    'park open',
    'address situs',
    'building footprint structure',
    'light streetlight lamp',
    'flood floodplain fema floodway',
    'trail path pathway',
    'bus transit stop',
    'tree forestry',
    'school education',
    'boundary limit city',
    'inlet catch basin',
    'valve',
    'irrigation ditch canal',
]
SYN = {}
for _group in SYNONYMS:
    for _w in _group.split():
        SYN[_w] = set(_group.split())
STOP_WORDS = set(('the a an of to for in on at by near nearest closest close closer from my our is are what which where whats how far '
                  'me i this that it there here any some all show find layer layers data feature features info about with within').split())
LINE_WORDS = {'line', 'main', 'pipe', 'pipeline', 'conduit', 'street', 'road', 'centerline', 'trail', 'path', 'ditch', 'canal', 'curb'}
AREA_WORDS = {'parcel', 'zoning', 'zone', 'flood', 'floodplain', 'district', 'boundary', 'subdivision', 'park', 'neighborhood', 'ward', 'precinct', 'annexation', 'easement', 'lot', 'property', 'tax'}
POINT_WORDS = {'hydrant', 'manhole', 'valve', 'inlet', 'light', 'streetlight', 'stop', 'tree', 'meter', 'sign', 'point', 'cleanout'}


def singular(w):
    if len(w) > 4 and w.endswith('ies'):
        return w[:-3] + 'y'
    if len(w) > 4 and w.endswith(('ches', 'shes', 'sses')):
        return w[:-2]
    if len(w) > 3 and w.endswith('s') and not w.endswith('ss'):
        return w[:-1]
    return w


@lru_cache(maxsize=20000)
def layer_words(text):
    words = re.sub(r'([a-z])([A-Z])', r'\1 \2', str(text or '')).lower()
    return [singular(w) for w in re.split(r'[^a-z0-9]+', words) if w and w not in STOP_WORDS]


def osa(a, b):
    """Edit distance counting a swap of two letters as one edit ("lien" -> "line")."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


# Other forms of one word (not just a related word): "zone" in "what zone is it" is zoning.
FORMS = {'zone': 'zoning', 'zoned': 'zoning', 'owner': 'parcel', 'ownership': 'parcel', 'lot': 'parcel'}


@lru_cache(maxsize=50000)
def fix_word(w):
    """A word as the synonym list knows it, allowing one typo in longer words."""
    if w in FORMS:
        return FORMS[w]
    if w in SYN or len(w) < 4:
        return w
    for known in SYN:
        if len(known) >= 4 and abs(len(known) - len(w)) <= 1 and osa(w, known) <= 1:
            return known
    return w


@lru_cache(maxsize=200000)
def word_match(w, n):
    # A word with a usual meaning ("zone" means zoning) matches that meaning best.
    if w in FORMS and fix_word(n) == FORMS[w] and n != w:
        return 1.0
    if w == n:
        return 0.95 if w in FORMS else 1.0
    fw, fn = fix_word(w), fix_word(n)
    if fw == fn:
        return 0.9
    if fn in SYN.get(fw, ()):
        return 0.85
    if len(w) >= 4 and len(n) >= 4 and osa(w, n) <= 1:
        return 0.8
    if len(w) >= 3 and (n.startswith(w) or w.startswith(n)) and min(len(w), len(n)) >= 3:
        return 0.6
    return 0.0


def geometry_hint(words):
    fixed = {fix_word(w) for w in words}
    if fixed & LINE_WORDS:
        return 'esriGeometryPolyline'
    if fixed & POINT_WORDS:
        return 'esriGeometryPoint'
    if fixed & AREA_WORDS:
        return 'esriGeometryPolygon'
    return None


# -- distances on the ground, in feet, near one place (flat-earth is fine at city scale)

FEET_PER_DEGREE_LAT = 364000.0


class Ground:
    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon
        self.kx = FEET_PER_DEGREE_LAT * math.cos(math.radians(lat))

    def xy(self, lon, lat):
        return (lon - self.lon) * self.kx, (lat - self.lat) * FEET_PER_DEGREE_LAT

    def lonlat(self, x, y):
        return self.lon + x / self.kx, self.lat + y / FEET_PER_DEGREE_LAT

    def nearest(self, geom):
        """(feet, (lon, lat) of the closest spot, inside) from the origin to a point, line or polygon."""
        if not geom:
            return None
        if 'x' in geom and 'y' in geom:
            x, y = self.xy(geom['x'], geom['y'])
            return math.hypot(x, y), (geom['x'], geom['y']), False
        best = None
        parts = [p for p in (geom.get('paths') or []) + (geom.get('rings') or []) if p]
        for pt in geom.get('points') or []:
            parts.append([pt])
        for part in parts:
            pts = [self.xy(p[0], p[1]) for p in part]
            if len(pts) == 1:
                cand = [(math.hypot(*pts[0]), pts[0])]
            else:
                cand = [seg_closest(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
            for d, spot in cand:
                if best is None or d < best[0]:
                    best = (d, spot)
        if best is None:
            return None
        inside = bool(geom.get('rings')) and point_in_rings([[self.xy(p[0], p[1]) for p in r] for r in geom['rings']])
        lon, lat = self.lonlat(*best[1])
        if inside:
            return 0.0, (self.lon, self.lat), True
        return best[0], (lon, lat), False


def seg_closest(a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    px, py = ax + t * dx, ay + t * dy
    return math.hypot(px, py), (px, py)


def point_in_rings(rings):
    """Is the origin inside? Even-odd over every ring, so holes count."""
    inside = False
    for ring in rings:
        for i in range(len(ring)):
            (x1, y1), (x2, y2) = ring[i - 1], ring[i]
            if (y1 > 0) != (y2 > 0) and 0 < x1 + (0 - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def feet_text(ft):
    if ft < 1:
        return 'right there'
    if ft < 1000:
        return 'about %d ft away' % max(1, int(round(ft / 5.0) * 5 if ft >= 20 else round(ft)))
    miles = ft / 5280.0
    return 'about %s mi away' % ('%.1f' % miles if miles < 10 else '%d' % round(miles))


def center_of(geom):
    """A representative point for a feature, in the output spatial reference."""
    if not geom:
        return None
    if 'x' in geom and 'y' in geom:
        return geom['x'], geom['y']
    pts = []
    for key in ('rings', 'paths'):
        for part in geom.get(key) or []:
            pts.extend(part)
    pts.extend(geom.get('points') or [])
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def value_text(field, value):
    if value is None:
        return ''
    if field.get('type') == 'esriFieldTypeDate' and isinstance(value, (int, float)):
        return time.strftime('%Y-%m-%d', time.gmtime(value / 1000))
    domain = field.get('domain') or {}
    for cv in domain.get('codedValues') or []:
        if cv.get('code') == value:
            return str(cv.get('name'))
    return str(value)


# -- field labels: the alias when it is a real label, else the field name made readable

FIELD_ABBR = {
    'num': 'Number', 'nbr': 'Number', 'no': 'Number', 'addr': 'Address', 'adr': 'Address', 'desc': 'Description', 'descr': 'Description',
    'cd': 'Code', 'typ': 'Type', 'stat': 'Status', 'dt': 'Date', 'yr': 'Year', 'qty': 'Quantity', 'amt': 'Amount', 'sqft': 'Sq Ft',
    'diam': 'Diameter', 'dia': 'Diameter', 'matl': 'Material', 'elev': 'Elevation', 'lat': 'Latitude', 'lng': 'Longitude', 'lon': 'Longitude',
    'jt': 'Joint', 'ownr': 'Owner', 'acct': 'Account', 'dept': 'Department', 'dist': 'District', 'inst': 'Install', 'insp': 'Inspection',
    'maint': 'Maintenance', 'rd': 'Road', 'zn': 'Zone', 'fld': 'Flood', 'ph': 'Phone', 'tel': 'Phone', 'ord': 'Ordinance',
    'subdiv': 'Subdivision', 'bldg': 'Building', 'impr': 'Improvement', 'val': 'Value', 'assd': 'Assessed', 'mkt': 'Market', 'nm': 'Name',
    'pct': 'Percent', 'avg': 'Average', 'tot': 'Total', 'cnt': 'Count', 'seq': 'Sequence', 'rte': 'Route', 'fac': 'Facility', 'loc': 'Location',
    'muni': 'Municipality', 'juris': 'Jurisdiction', 'cmt': 'Comment', 'mfr': 'Manufacturer', 'len': 'Length', 'eff': 'Effective',
    'act': 'Actual', 'strname': 'Street Name', 'stname': 'Street Name', 'stnum': 'Street Number', 'blt': 'Built', 'auth': 'Authority',
    'ayb': 'Actual Year Built', 'eyb': 'Effective Year Built', 'lu': 'Land Use', 'esmt': 'Easement', 'rec': 'Reception'}
FIELD_ACRONYMS = {'id', 'oid', 'fid', 'gis', 'pin', 'apn', 'fema', 'gps', 'uid', 'guid', 'url', 'zip', 'hoa', 'row', 'ne', 'nw', 'se', 'sw',
                  'pvc', 'dip', 'hdpe', 'rcp', 'vcp', 'sfha', 'firm', 'us', 'cr', 'hwy', 'pdf'}
FIELD_WORDS = set('''parcel owner name joint mailing mail address street number city state zip county zone zoning district year built platted
plat date type status code school facility sewer storm water main line size length width height area acres land use value legal description
subdivision reception lots lot drainage report file route day pickup recycling trash council rep elevation material diameter install installed
condition inspection location last first full house unit suite phone email website web site notes note comment comments total count class
effective actual assessed market improvement building account tax authority pointer neighborhood ward precinct flood hazard panel permit
project module case work order asset feature label start end up down stream invert depth slope pipe valve hydrant manhole meter service
station pump tank basin inlet outfall culvert ditch canal irrigation electric gas utility provider company contact title middle suffix prefix
direction center north south east west road lane trail park open space boundary limits municipal jurisdiction annexation ordinance overlay
historic ownership deed book page source method editor edited created modified updated global object shape latitude longitude distance feet
percent average minimum maximum rank score priority risk rating grade level floor sign signal light pole tree species photo image link
document drawing plan sheet time'''.split())


def _segment(run):
    s = run.lower()
    if len(s) < 6 or s in FIELD_WORDS:
        return None
    best = [None] * (len(s) + 1)
    best[0] = []
    for i in range(1, len(s) + 1):
        for j in range(max(0, i - 14), i):
            piece = s[j:i]
            if best[j] is None or len(piece) < 2:
                continue
            if not (piece in FIELD_WORDS or piece in FIELD_ABBR or piece in FIELD_ACRONYMS):
                continue
            cand = best[j] + [piece]
            real = lambda x: sum(1 for p in x if p in FIELD_WORDS)
            if best[i] is None or len(cand) < len(best[i]) or (len(cand) == len(best[i]) and real(cand) > real(best[i])):
                best[i] = cand
    out = best[len(s)]
    return out if out and len(out) > 1 else None


def humanize_name(name):
    n = str(name or '').strip()
    if not n:
        return ''
    if re.search(r'shape[._]*(st)?area|^st_area', n, re.I):
        return 'Area'
    if re.search(r'shape[._]*(st)?len(gth)?|^st_length', n, re.I):
        return 'Length'
    if '.' in n and not n.endswith('()'):
        n = n.split('.')[-1]
    n = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', n)
    n = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', n)
    n = re.sub(r'([A-Za-z])(\d)', r'\1 \2', n)
    n = re.sub(r'(\d)\s*(st|nd|rd|th)\b', lambda m: m.group(1) + m.group(2).lower() + ' ', n, flags=re.I)
    raw = [t for t in re.split(r'[_\-.\s]+', n) if t]
    words = []
    for i, t in enumerate(raw):
        low = t.lower()
        if low == 'no' and i != len(raw) - 1:
            words.append(t)
        elif re.match(r'^\d+(st|nd|rd|th)$', low):
            words.append(low)
        elif low in FIELD_ABBR:
            words.extend(FIELD_ABBR[low].split())
        else:
            parts = _segment(t)
            if parts:
                words.extend(FIELD_ABBR[p] if p in FIELD_ABBR and p not in FIELD_WORDS else p for p in parts)
            elif len(low) >= 5 and low not in FIELD_WORDS:
                hit = next((w for w in sorted(FIELD_WORDS) if len(w) > len(low) and w.startswith(low)), None)
                words.append(hit or t)
            else:
                words.append(t)
    out = []
    for i, w in enumerate(' '.join(words).split()):
        low = w.lower()
        if low in FIELD_ACRONYMS:
            out.append(low.upper())
        elif i and low in ('of', 'and', 'or', 'by', 'in', 'to', 'for', 'at', 'on', 'the', 'per'):
            out.append(low)
        elif low[:1].isdigit():
            out.append(w)
        else:
            out.append(low[:1].upper() + low[1:])
    text = ' '.join(out)
    return re.sub(r' (Feet|Ft)$', ' (ft)', text)


def _real_alias(alias, name):
    a = str(alias or '').strip()
    if not a:
        return False
    machine = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())
    if machine(a) == machine(name.split('.')[-1]):
        return bool(re.search(r'[a-z]', a) and re.search(r'[A-Z]', a) and ' ' in a)
    if not re.search(r'[a-z]', a) and len(a) > 3:
        return False
    return True


def label(field):
    """What people see for a field: its alias when it is a real label, else the name made readable."""
    name = field.get('name') or ''
    alias = field.get('alias') or ''
    if _real_alias(alias, name):
        return alias.strip()
    return humanize_name(alias if alias.strip() else name) or name


def short_address(text):
    """'250 N 5TH ST, GRAND JUNCTION, CO, 81501' -> '250 N 5th St'."""
    first = str(text or '').split(',')[0].strip()

    def word(w):
        if re.search(r'\d', w):
            return w.lower()
        if w.upper() in ('N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO', 'US', 'CR'):
            return w.upper()
        return w[:1].upper() + w[1:].lower()
    return ' '.join(word(w) for w in first.split()) or str(text or '')


def singular_label(name):
    words = str(name).split(' - ')[-1].split()
    if words:
        last = words[-1]
        low = last.lower()
        if low.endswith('ies') and len(low) > 4:
            last = last[:-3] + ('Y' if last.isupper() else 'y')
        elif low.endswith(('ches', 'shes', 'sses')):
            last = last[:-2]
        elif low.endswith('s') and not low.endswith('ss') and len(low) > 3:
            last = last[:-1]
        words[-1] = last
    out = ' '.join(words)
    return out.lower() if not out.isupper() else out


def cap(s):
    return s[:1].upper() + s[1:]


def feature_name(attrs, show, meta):
    """What to call one feature: its display field, else its first filled-in field."""
    display = meta.get('displayField')
    fields = {f['name']: f for f in show}
    if display and attrs.get(display) not in (None, ''):
        f = fields.get(display) or {'name': display}
        return '%s %s' % (label(f), value_text(f, attrs[display])) if re.fullmatch(r'[\d.-]+', str(attrs[display])) else value_text(f, attrs[display])
    for f in show:
        v = attrs.get(f['name'])
        if v not in (None, ''):
            return '%s %s' % (label(f), value_text(f, v))
    return ''


# ---------------------------------------------------------------- tools

class Tools:
    def __init__(self, cfg, gis, layers):
        self.cfg = cfg
        self.gis = gis
        self.layers = layers

    def definitions(self):
        names = self.layers.names()
        layer_prop = {'type': 'string', 'description': 'Layer name, as list_layers shows it.'}
        if 0 < len(names) <= 200:
            layer_prop['enum'] = names
        ro = {'readOnlyHint': True, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}
        tools = []
        if self.cfg.get('locator_url'):
            tools.append({
                'name': 'geocode', 'title': 'Find an address',
                'description': 'Geocode: find the location of a street address, intersection or place name with the city address locator.',
                'inputSchema': {'type': 'object', 'properties': {
                    'address': {'type': 'string', 'description': 'Address or place, for example 250 N 5th St.'},
                    'max_results': {'type': 'integer', 'minimum': 1, 'maximum': 20, 'default': 5}}, 'required': ['address']},
                'annotations': dict(ro, title='Find an address')})
            tools.append({
                'name': 'reverse_geocode', 'title': 'Address at a point',
                'description': 'Reverse geocode: the street address nearest a point (latitude and longitude).',
                'inputSchema': {'type': 'object', 'properties': {
                    'latitude': {'type': 'number'}, 'longitude': {'type': 'number'}}, 'required': ['latitude', 'longitude']},
                'annotations': dict(ro, title='Address at a point')})
        geo = bool(self.cfg.get('locator_url'))
        place_props = {'latitude': {'type': 'number'}, 'longitude': {'type': 'number'}}
        if geo:
            place_props = dict({'address': {'type': 'string', 'description': 'Street address or place (instead of latitude and longitude).'}}, **place_props)
        words_prop = {'type': 'string', 'description': 'What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning.'}
        # Layer tools are listed even before layer names are known (a folder that needs a sign-in
        # is read on the first signed-in call), so a client never caches a list without them.
        if names or self.cfg.get('service_folders') or self.cfg.get('layers'):
            tools.append({
                'name': 'nearest_feature', 'title': 'Closest feature',
                'description': 'Nearest / closest feature: the closest sewer line, water main, hydrant, park, school, bus stop or any layer to an address or point, with the distance in feet.',
                'inputSchema': {'type': 'object', 'properties': dict({'layer': words_prop}, **place_props, max_results={'type': 'integer', 'minimum': 1, 'maximum': 10, 'default': 3}),
                                'required': ['layer']},
                'annotations': dict(ro, title='Closest feature')})
            tools.append({
                'name': 'features_near', 'title': 'Features within a distance',
                'description': 'Features within a distance (buffer) of an address or point: what hydrants are within 500 feet, how many parcels within a quarter mile.',
                'inputSchema': {'type': 'object', 'properties': dict({'layer': words_prop}, **place_props, distance_feet={'type': 'number', 'minimum': 1, 'maximum': 26400, 'default': 500},
                                                                     max_results={'type': 'integer', 'minimum': 1, 'maximum': self.cfg['max_results'], 'default': 25}),
                                'required': ['layer']},
                'annotations': dict(ro, title='Features within a distance')})
            tools.append({
                'name': 'identify', 'title': "What's here",
                'description': 'Identify / property report: what is at an address or point, such as the parcel and owner, zoning district, flood zone and every other layer at that spot.',
                'inputSchema': {'type': 'object', 'properties': dict(place_props, layer=dict(words_prop, description='Only this layer (optional), such as zoning or flood zone.')), 'required': []},
                'annotations': dict(ro, title="What's here")})
            tools.append({
                'name': 'summarize_layer', 'title': 'Summarize a layer',
                'description': 'Summary statistics: count features grouped by a field (sewer mains by material, parcels by zoning) and the total, optionally only those matching some text.',
                'inputSchema': {'type': 'object', 'properties': {
                    'layer': words_prop, 'group_by': {'type': 'string', 'description': 'Field to group by, by name or alias (optional).'},
                    'text': {'type': 'string', 'description': 'Only features matching these words (optional).'}}, 'required': ['layer']},
                'annotations': dict(ro, title='Summarize a layer')})
            tools.append({
                'name': 'find_features', 'title': 'Search a layer',
                'description': 'Find features in a layer by name, address, owner, number or id. Returns matching records with a location.',
                'inputSchema': {'type': 'object', 'properties': {
                    'layer': layer_prop, 'text': {'type': 'string', 'description': 'Words to look for.'},
                    'max_results': {'type': 'integer', 'minimum': 1, 'maximum': self.cfg['max_results'], 'default': 10}}, 'required': ['layer', 'text']},
                'annotations': dict(ro, title='Search a layer')})
            tools.append({
                'name': 'count_features', 'title': 'Count features',
                'description': 'Count how many features a layer has, optionally only those matching some text.',
                'inputSchema': {'type': 'object', 'properties': {
                    'layer': layer_prop, 'text': {'type': 'string', 'description': 'Only count features matching these words (optional).'}}, 'required': ['layer']},
                'annotations': dict(ro, title='Count features')})
            tools.append({
                'name': 'describe_layer', 'title': 'Describe a layer',
                'description': 'The schema of a layer before querying it: every field with its type (text, number, date) and allowed values, the record count, the geometry type and when the data was last edited. Use it to pick fields for query_layer.',
                'inputSchema': {'type': 'object', 'properties': {'layer': words_prop}, 'required': ['layer']},
                'annotations': dict(ro, title='Describe a layer')})
            tools.append({
                'name': 'query_layer', 'title': 'Query a layer',
                'description': ('Structured data question on one layer, with no SQL: filters on fields (=, !=, >, >=, <, <=, contains, starts_with, in, not_in, '
                                'between, is_null, not_null, in_last_days), then either rows (fields, order_by, descending, max_results), a count (count_only), '
                                'or a statistic (count, sum, avg, min, max of stat_field), optionally per group_by value. Dates are YYYY-MM-DD; in_last_days takes a number of days. '
                                'Coded values can be given by label or code. Call describe_layer first to see field names and values.'),
                'inputSchema': {'type': 'object', 'properties': {
                    'layer': words_prop,
                    'filters': {'type': 'array', 'maxItems': 5, 'description': 'All must match (AND).', 'items': {'type': 'object', 'properties': {
                        'field': {'type': 'string', 'description': 'Field name or alias.'},
                        'op': {'type': 'string', 'enum': list(QUERY_OPS)},
                        'value': {'description': 'A number, text, date (YYYY-MM-DD), or for in/not_in a list. Days for in_last_days.'},
                        'value2': {'description': 'Upper bound for between.'}}, 'required': ['field', 'op']}},
                    'text': {'type': 'string', 'description': 'Also only features matching these words (optional).'},
                    'count_only': {'type': 'boolean', 'default': False},
                    'statistic': {'type': 'string', 'enum': ['count', 'sum', 'avg', 'min', 'max']},
                    'stat_field': {'type': 'string', 'description': 'Field for sum, avg, min or max.'},
                    'group_by': {'type': 'string', 'description': 'Field to group the statistic by (optional).'},
                    'fields': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 15, 'description': 'Fields to return with rows (optional).'},
                    'order_by': {'type': 'string', 'description': 'Field to sort rows by (optional).'},
                    'descending': {'type': 'boolean', 'default': False},
                    'max_results': {'type': 'integer', 'minimum': 1, 'maximum': self.cfg['max_results'], 'default': 25}}, 'required': ['layer']},
                'annotations': dict(ro, title='Query a layer')})
            tools.append({
                'name': 'list_layers', 'title': 'List searchable layers',
                'description': 'List the GIS layers these tools can search and identify.',
                'inputSchema': {'type': 'object', 'properties': {}},
                'annotations': dict(ro, title='List searchable layers')})
        if self.cfg.get('portal_url'):
            tools.append({
                'name': 'search_content', 'title': 'Find maps and data',
                'description': 'Search Portal for maps, apps, layers and documents by keyword.',
                'inputSchema': {'type': 'object', 'properties': {
                    'query': {'type': 'string', 'description': 'Keywords, for example zoning or storm sewer.'},
                    'max_results': {'type': 'integer', 'minimum': 1, 'maximum': 25, 'default': 10}}, 'required': ['query']},
                'annotations': dict(ro, title='Find maps and data')})
        return tools

    def call(self, name, args, token, referer):
        fn = getattr(self, 'tool_' + str(name), None)
        if not fn or name not in {t['name'] for t in self.definitions()}:
            raise RpcError(-32602, 'Unknown tool: %s' % name)
        if not isinstance(args, dict):
            raise RpcError(-32602, 'Arguments must be an object.')
        return fn(args, token, referer)

    # -- addresses
    def tool_geocode(self, a, token, referer):
        address = clean_text(a.get('address'))
        if len(address) < 2:
            raise ToolError('Give an address or place to find.')
        n = int(number(a.get('max_results', 5), 'max_results', 1, 20))
        out = self.gis.get(self.cfg['locator_url'] + '/findAddressCandidates', {
            self.cfg.get('locator_single_line_field') or 'SingleLine': address,
            'outFields': 'Match_addr,Addr_type', 'maxLocations': n, 'outSR': 4326}, token, referer)
        rows = []
        for c in (out.get('candidates') or [])[:n]:
            loc = c.get('location') or {}
            attrs = c.get('attributes') or {}
            rows.append({'address': c.get('address') or attrs.get('Match_addr'), 'score': round(c.get('score') or 0),
                         'type': attrs.get('Addr_type') or '', 'latitude': round(loc.get('y'), 6) if loc.get('y') is not None else None,
                         'longitude': round(loc.get('x'), 6) if loc.get('x') is not None else None})
        if not rows:
            return 'No match for "%s".' % address, {'candidates': []}
        return 'Found %d match%s for "%s"; best: %s.' % (len(rows), '' if len(rows) == 1 else 'es', address, rows[0]['address']), {'candidates': rows}

    def tool_reverse_geocode(self, a, token, referer):
        lat = number(a.get('latitude'), 'latitude', -90, 90)
        lon = number(a.get('longitude'), 'longitude', -180, 180)
        out = self.gis.get(self.cfg['locator_url'] + '/reverseGeocode', {
            'location': json.dumps({'x': lon, 'y': lat, 'spatialReference': {'wkid': 4326}}), 'outSR': 4326}, token, referer)
        addr = (out.get('address') or {})
        text = addr.get('Match_addr') or addr.get('LongLabel') or addr.get('Address')
        if not text:
            return 'No address found near that point.', {'address': None, 'latitude': lat, 'longitude': lon}
        loc = out.get('location') or {}
        return 'Nearest address: %s.' % text, {'address': text, 'latitude': round(loc.get('y', lat), 6), 'longitude': round(loc.get('x', lon), 6)}

    # -- layers
    def _layer(self, name):
        layer = self.layers.find(clean_text(name, 120))
        if not layer:
            raise ToolError('There is no layer called "%s". Layers: %s.' % (clean_text(name, 60), ', '.join(self.layers.names()[:40])))
        return layer

    def _where(self, layer, meta, text):
        fields = self.layers.search_fields(layer, meta)
        if not fields:
            raise ToolError('%s has no text fields to search.' % layer['name'])
        words = [w for w in re.split(r'\s+', text.upper()) if w][:6]
        # Every word must appear in at least one searchable field.
        parts = []
        for w in words:
            w = sql_text(w.replace('%', '').replace('_', ' ').strip())
            if not w:
                continue
            parts.append('(' + ' OR '.join("UPPER(%s) LIKE '%%%s%%'" % (f, w) for f in fields) + ')')
        return ' AND '.join(parts) or '1=1'

    def tool_find_features(self, a, token, referer):
        layer = self._layer(a.get('layer'))
        text = clean_text(a.get('text'), 120)
        if not text:
            raise ToolError('Say what to look for in %s.' % layer['name'])
        n = int(number(a.get('max_results', 10), 'max_results', 1, self.cfg['max_results']))
        meta = self.layers.info(layer, token, referer)
        show = self.layers.show_fields(layer, meta)
        is_table = not meta.get('geometryType')
        out = self.gis.get(layer['url'] + '/query', {
            'where': self._where(layer, meta, text), 'outFields': ','.join(f['name'] for f in show) or '*',
            'returnGeometry': 'false' if is_table else 'true', 'outSR': 4326, 'geometryPrecision': 6,
            'maxAllowableOffset': 0.0001, 'resultRecordCount': n}, token, referer)
        rows = []
        for feat in (out.get('features') or [])[:n]:
            attrs = feat.get('attributes') or {}
            row = {label(f): value_text(f, attrs.get(f['name'])) for f in show}
            c = center_of(feat.get('geometry'))
            if c:
                row['longitude'], row['latitude'] = round(c[0], 6), round(c[1], 6)
            rows.append(row)
        more = ' (showing the first %d)' % n if out.get('exceededTransferLimit') else ''
        return 'Found %d in %s matching "%s"%s.' % (len(rows), layer['name'], text, more), {'layer': layer['name'], 'features': rows}

    def tool_count_features(self, a, token, referer):
        layer = self._layer(a.get('layer'))
        text = clean_text(a.get('text'), 120)
        meta = self.layers.info(layer, token, referer)
        where = self._where(layer, meta, text) if text else '1=1'
        out = self.gis.get(layer['url'] + '/query', {'where': where, 'returnCountOnly': 'true'}, token, referer)
        count = int(out.get('count') or 0)
        return '%s has %s feature%s%s.' % (layer['name'], format(count, ','), '' if count == 1 else 's', ' matching "%s"' % text if text else ''), {'layer': layer['name'], 'count': count}

    # -- structured data questions (for assistants): the schema first, then a query without SQL
    def _fields(self, meta):
        return [f for f in meta.get('fields') or [] if f.get('type') not in ('esriFieldTypeGeometry', 'esriFieldTypeBlob', 'esriFieldTypeRaster')
                and FIELD_NAME.match(f.get('name') or '')]

    def _field(self, layer, meta, name):
        """A field by name, alias or plain words ("install date"); ToolError listing the fields otherwise."""
        want = clean_text(name, 80)
        fields = self._fields(meta)
        key = re.sub(r'[\s_]+', '', want.lower())
        for f in fields:
            if key and key in (re.sub(r'[\s_]+', '', f['name'].lower()), re.sub(r'[\s_]+', '', (f.get('alias') or '').lower()), re.sub(r'[\s_]+', '', label(f).lower())):
                return f
        gw = layer_words(want)
        best, score = None, 0.0
        for f in fields:
            fw = layer_words(f['name'] + ' ' + (f.get('alias') or ''))
            sc = sum(max([word_match(w, x) for x in fw] or [0]) for w in gw) / max(1, len(gw))
            if sc > score:
                best, score = f, sc
        if best and score >= 0.6:
            return best
        raise ToolError('%s has no field like "%s". Fields: %s.' % (layer['name'], want, ', '.join('%s (%s)' % (f['name'], field_kind(f)) for f in fields[:40])))

    def _literal(self, field, value):
        """One value as SQL for this field: a number, quoted text (coded labels become codes) or a TIMESTAMP."""
        kind = field_kind(field)
        for cv in (field.get('domain') or {}).get('codedValues') or []:
            if isinstance(value, str) and str(cv.get('name', '')).lower() == value.strip().lower():
                value = cv.get('code')
                break
        if kind == 'number':
            try:
                n = float(value)
            except (TypeError, ValueError):
                raise ToolError('%s is a number field; "%s" is not a number.' % (label(field), clean_text(value, 40)))
            if math.isnan(n) or math.isinf(n):
                raise ToolError('%s needs a finite number.' % label(field))
            return repr(int(n)) if n.is_integer() else repr(n)
        if kind == 'date':
            return "TIMESTAMP '%s'" % parse_day(value).strftime('%Y-%m-%d %H:%M:%S')
        if isinstance(value, (dict, list)):
            raise ToolError('%s needs a single value.' % label(field))
        return "'%s'" % sql_text(clean_text(value, 200))

    def _filter(self, layer, meta, f):
        if not isinstance(f, dict):
            raise ToolError('Each filter is an object with field, op and value.')
        field = self._field(layer, meta, f.get('field'))
        name = field['name']
        op = str(f.get('op') or '').strip().lower()
        if op not in QUERY_OPS:
            raise ToolError('Unknown op "%s". Use one of: %s.' % (clean_text(op, 20), ', '.join(QUERY_OPS)))
        kind = field_kind(field)
        v = f.get('value')
        if op == 'is_null':
            return '%s IS NULL' % name
        if op == 'not_null':
            return '%s IS NOT NULL' % name
        if op == 'in_last_days':
            if kind != 'date':
                raise ToolError('in_last_days needs a date field; %s is %s.' % (label(field), kind))
            days = number(v, 'value (days)', 1, 36500)
            since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
            return "%s >= TIMESTAMP '%s'" % (name, since.strftime('%Y-%m-%d %H:%M:%S'))
        if op in ('contains', 'starts_with'):
            if kind != 'text':
                raise ToolError('%s works on text fields; %s is %s.' % (op, label(field), kind))
            t = sql_text(clean_text(v, 120)).replace('%', '').replace('_', ' ').strip().upper()
            if not t:
                raise ToolError('Give some text for %s.' % op)
            return "UPPER(%s) LIKE '%s%s%%'" % (name, '%' if op == 'contains' else '', t)
        if op in ('in', 'not_in'):
            items = v if isinstance(v, list) else [x for x in re.split(r'\s*,\s*', str(v or '')) if x]
            if not items or len(items) > 25:
                raise ToolError('Give 1 to 25 values for %s.' % op)
            return '%s %s (%s)' % (name, 'IN' if op == 'in' else 'NOT IN', ', '.join(self._literal(field, x) for x in items))
        if op == 'between':
            if v is None or f.get('value2') is None:
                raise ToolError('between needs value and value2.')
            if kind == 'date':
                lo, hi = parse_day(v), parse_day(f.get('value2')) + timedelta(days=1)
                return "(%s >= TIMESTAMP '%s' AND %s < TIMESTAMP '%s')" % (name, lo.strftime('%Y-%m-%d %H:%M:%S'), name, hi.strftime('%Y-%m-%d %H:%M:%S'))
            return '(%s >= %s AND %s <= %s)' % (name, self._literal(field, v), name, self._literal(field, f.get('value2')))
        if v is None:
            raise ToolError('%s needs a value.' % op)
        if kind == 'date' and op in ('=', '!='):
            day = parse_day(v)
            rng = "(%s >= TIMESTAMP '%s' AND %s < TIMESTAMP '%s')" % (name, day.strftime('%Y-%m-%d %H:%M:%S'), name, (day + timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S'))
            return rng if op == '=' else 'NOT ' + rng
        return '%s %s %s' % (name, '<>' if op == '!=' else op, self._literal(field, v))

    def tool_describe_layer(self, a, token, referer):
        layer, others = self._resolve(a.get('layer'))
        meta = self.layers.info(layer, token, referer)
        rows = []
        for f in self._fields(meta):
            row = {'name': f['name'], 'label': label(f), 'type': field_kind(f)}
            values = [str(cv.get('name')) for cv in ((f.get('domain') or {}).get('codedValues') or [])][:30]
            if values:
                row['values'] = values
            rows.append(row)
        try:
            count = int(self.gis.get(layer['url'] + '/query', {'where': '1=1', 'returnCountOnly': 'true'}, token, referer).get('count') or 0)
        except ToolError:
            count = None
        edited = ((meta.get('editingInfo') or {}).get('lastEditDate') or (meta.get('editingInfo') or {}).get('dataLastEditDate'))
        info = {'layer': layer['name'], 'geometry': (meta.get('geometryType') or 'table').replace('esriGeometry', '').lower(), 'count': count, 'fields': rows}
        if edited:
            info['last_edited'] = time.strftime('%Y-%m-%d', time.gmtime(edited / 1000))
        desc = re.sub(r'<[^>]+>', ' ', str(meta.get('description') or ''))
        if desc.strip():
            info['description'] = clean_text(re.sub(r'\s+', ' ', desc), 300)
        dates = [r['name'] for r in rows if r['type'] == 'date']
        text = '%s: %s%s, %d fields%s%s.' % (layer['name'], info['geometry'], '' if count is None else ', %s records' % format(count, ','), len(rows),
                                             '; date fields: ' + ', '.join(dates) if dates else '', '; last edited ' + info['last_edited'] if edited else '')
        if others:
            text += ' (Also close: %s.)' % ', '.join(others)
        return text, info

    def tool_query_layer(self, a, token, referer):
        layer, others = self._resolve(a.get('layer'))
        meta = self.layers.info(layer, token, referer)
        filters = a.get('filters') or []
        if not isinstance(filters, list) or len(filters) > 5:
            raise ToolError('filters is a list of up to 5 conditions.')
        parts = [self._filter(layer, meta, f) for f in filters]
        text = clean_text(a.get('text'), 120)
        if text:
            parts.append(self._where(layer, meta, text))
        where = ' AND '.join('(%s)' % p for p in parts) if parts else '1=1'
        said = '; '.join('%s %s %s' % (clean_text(f.get('field'), 40), f.get('op'), clean_text(json.dumps(f.get('value')) if f.get('value') is not None else '', 60)) for f in filters if isinstance(f, dict))
        scope = (' where ' + said if said else '') + (' matching "%s"' % text if text else '')
        stat = clean_text(a.get('statistic'), 10).lower()
        group = clean_text(a.get('group_by'), 80)
        if a.get('count_only') and not stat and not group:
            count = int(self.gis.get(layer['url'] + '/query', {'where': where, 'returnCountOnly': 'true'}, token, referer).get('count') or 0)
            return '%s: %s matching%s.' % (layer['name'], format(count, ','), scope), {'layer': layer['name'], 'where': where, 'count': count}
        if stat or group:
            stat = stat or 'count'
            if stat not in ('count', 'sum', 'avg', 'min', 'max'):
                raise ToolError('statistic is one of count, sum, avg, min, max.')
            gfield = self._field(layer, meta, group) if group else None
            if stat == 'count':
                sfield = {'name': (meta.get('objectIdField') or next((f['name'] for f in meta.get('fields') or [] if f.get('type') == 'esriFieldTypeOID'), None) or (gfield or {}).get('name') or self._fields(meta)[0]['name'])}
            else:
                if not a.get('stat_field'):
                    raise ToolError('Give stat_field for %s.' % stat)
                sfield = self._field(layer, meta, a.get('stat_field'))
                if field_kind(sfield) != 'number':
                    raise ToolError('%s is not a number field, so it has no %s.' % (label(sfield), stat))
            stats = [{'statisticType': 'count', 'onStatisticField': sfield['name'] if stat == 'count' else (meta.get('objectIdField') or sfield['name']), 'outStatisticFieldName': 'mappy_count'}]
            if stat != 'count':
                stats.append({'statisticType': stat, 'onStatisticField': sfield['name'], 'outStatisticFieldName': 'mappy_value'})
            params = {'where': where, 'returnGeometry': 'false', 'outStatistics': json.dumps(stats)}
            if gfield:
                params['groupByFieldsForStatistics'] = gfield['name']
            out = self.gis.get(layer['url'] + '/query', params, token, referer)
            rows = []
            for feat in out.get('features') or []:
                at = {k.lower(): v for k, v in (feat.get('attributes') or {}).items()}
                row = {}
                if gfield:
                    row[label(gfield)] = value_text(gfield, at.get(gfield['name'].lower())) or '(blank)'
                row['count'] = int(at.get('mappy_count') or 0)
                if stat != 'count':
                    v = at.get('mappy_value')
                    row[stat] = round(v, 4) if isinstance(v, float) else v
                rows.append(row)
            key = 'count' if stat == 'count' else stat
            rows.sort(key=lambda r: -(r.get(key) if isinstance(r.get(key), (int, float)) else float('-inf')))
            what = 'count' if stat == 'count' else '%s of %s' % (stat, label(sfield))
            if not rows:
                return 'Nothing in %s%s.' % (layer['name'], scope), {'layer': layer['name'], 'where': where, 'rows': []}
            if gfield:
                head = '%s: %s by %s%s, %d groups. Top: %s.' % (layer['name'], what, label(gfield), scope, len(rows),
                                                                ', '.join('%s %s' % (r[label(gfield)], r.get(key)) for r in rows[:4]))
            else:
                head = '%s: %s%s = %s (%s records).' % (layer['name'], what, scope, rows[0].get(key), format(rows[0]['count'], ','))
            return head, {'layer': layer['name'], 'where': where, 'statistic': stat, 'group_by': label(gfield) if gfield else None, 'rows': rows[:100]}
        n = int(number(a.get('max_results', 25), 'max_results', 1, self.cfg['max_results']))
        wanted = a.get('fields') or []
        if not isinstance(wanted, list) or len(wanted) > 15:
            raise ToolError('fields is a list of up to 15 field names.')
        show = [self._field(layer, meta, x) for x in wanted] or self.layers.show_fields(layer, meta)
        params = {'where': where, 'outFields': ','.join(f['name'] for f in show) or '*', 'resultRecordCount': n,
                  'returnGeometry': 'false' if not meta.get('geometryType') else 'true', 'outSR': 4326, 'geometryPrecision': 6, 'maxAllowableOffset': 0.0001}
        if a.get('order_by'):
            ob = self._field(layer, meta, a.get('order_by'))
            params['orderByFields'] = '%s %s' % (ob['name'], 'DESC' if a.get('descending') else 'ASC')
        out = self.gis.get(layer['url'] + '/query', params, token, referer)
        rows = []
        for feat in (out.get('features') or [])[:n]:
            at = feat.get('attributes') or {}
            row = {label(f): value_text(f, at.get(f['name'])) for f in show}
            c = center_of(feat.get('geometry'))
            if c:
                row['longitude'], row['latitude'] = round(c[0], 6), round(c[1], 6)
            rows.append(row)
        more = ' (first %d)' % n if out.get('exceededTransferLimit') or len(out.get('features') or []) > n else ''
        return '%d record%s from %s%s%s.' % (len(rows), '' if len(rows) == 1 else 's', layer['name'], scope, more), {'layer': layer['name'], 'where': where, 'rows': rows}

    def tool_list_layers(self, a, token, referer):
        rows = [{'name': v['name'], 'path': v.get('path') or v['name']} for v in sorted(self.layers.by_name.values(), key=lambda v: (v.get('path') or v['name']).lower())]
        return '%d layers can be searched.' % len(rows), {'layers': rows}

    def _place(self, a, token, referer):
        """(lat, lon, words for it) from latitude/longitude, or from an address through the locator."""
        if a.get('latitude') not in (None, '') and a.get('longitude') not in (None, ''):
            lat = number(a.get('latitude'), 'latitude', -90, 90)
            lon = number(a.get('longitude'), 'longitude', -180, 180)
            return lat, lon, 'that spot'
        address = clean_text(a.get('address'))
        if not address:
            raise ToolError('Give an address, or a latitude and longitude.')
        if not self.cfg.get('locator_url'):
            raise ToolError('No address locator is set up; give a latitude and longitude.')
        text, data = self.tool_geocode({'address': address, 'max_results': 1}, token, referer)
        c = (data.get('candidates') or [None])[0]
        if not c or c.get('latitude') is None:
            raise ToolError('I could not find the address "%s".' % address)
        if c.get('score', 100) < 75:
            raise ToolError('"%s" did not match an address well (closest: %s).' % (address, c.get('address')))
        return c['latitude'], c['longitude'], short_address(c.get('address') or address)

    def _spatial(self, layer, lat, lon, feet, token, referer, count=200):
        meta = self.layers.info(layer, token, referer)
        if not meta.get('geometryType'):
            raise ToolError('%s is a table without locations.' % layer['name'])
        show = self.layers.show_fields(layer, meta)
        out = self.gis.get(layer['url'] + '/query', {
            'geometry': json.dumps({'x': lon, 'y': lat, 'spatialReference': {'wkid': 4326}}), 'geometryType': 'esriGeometryPoint',
            'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'distance': feet, 'units': 'esriSRUnit_Foot',
            'outFields': ','.join(f['name'] for f in show) or '*', 'returnGeometry': 'true', 'outSR': 4326, 'geometryPrecision': 7,
            'resultRecordCount': count}, token, referer)
        return meta, show, out

    def _rows(self, feats, show, ground, meta):
        rows = []
        for feat in feats:
            attrs = feat.get('attributes') or {}
            hit = ground.nearest(feat.get('geometry'))
            if not hit:
                continue
            ft, (lon, lat), inside = hit
            row = {label(f): value_text(f, attrs.get(f['name'])) for f in show}
            row['distance_feet'] = int(round(ft))
            row['latitude'], row['longitude'] = round(lat, 6), round(lon, 6)
            rows.append((ft, inside, row, feature_name(attrs, show, meta)))
        rows.sort(key=lambda r: r[0])
        return rows

    def _resolve(self, text):
        """The layer for plain words, and close second choices to mention."""
        ranked = self.layers.resolve(clean_text(text, 120))
        exact = self.layers.by_name.get(clean_text(text, 120).lower())
        if exact:
            return exact, [v['name'] for s, v, _ in ranked if v is not exact][:2]
        if not ranked:
            if self.layers.find(clean_text(text, 120)):
                return self.layers.find(clean_text(text, 120)), []
            raise ToolError('I could not find a layer for "%s". Layers I can search: %s.' % (clean_text(text, 60), ', '.join(self.layers.names()[:40])))
        best = ranked[0]
        others = [v['name'] for s, v, _ in ranked[1:4] if s >= best[0] - 0.12]
        return best[1], others

    def _resolve_all(self, text):
        """The layer for plain words, plus any that fit them just as well ("manholes" when storm
        and sanitary both have one), and close second choices to mention."""
        words = clean_text(text, 120)
        exact = self.layers.by_name.get(words.lower())
        ranked = self.layers.resolve(words)
        if exact:
            return [exact], [v['name'] for s, v, _ in ranked if v is not exact][:2]
        if not ranked:
            layer, others = self._resolve(text)
            return [layer], others
        # Equally good: every word matched as well, the same kind of geometry ("manholes" under
        # storm and under sanitary, or a layer simply called Sewer Manholes).
        top = ranked[0][2]
        tied = [v for s, v, q in ranked if q[0] >= top[0] - 0.01 and q[1] == top[1]][:4]
        others = [v['name'] for s, v, q in ranked if not any(v is t for t in tied) and s >= ranked[0][0] - 0.15][:3]
        return tied, others

    def tool_nearest_feature(self, a, token, referer):
        layers, others = self._resolve_all(a.get('layer'))
        lat, lon, where = self._place(a, token, referer)
        n = int(number(a.get('max_results', 3), 'max_results', 1, 10))
        ground = Ground(lat, lon)
        limit = float(self.cfg.get('nearest_max_feet') or 26400)

        def search(layer):
            feet = 250.0
            while True:
                meta, show, out = self._spatial(layer, lat, lon, min(feet, limit), token, referer)
                rows = self._rows(out.get('features') or [], show, ground, meta)
                if len(rows) >= n or feet >= limit:
                    return rows
                feet *= 4

        # Several layers fit the words equally: look in each and answer with the closest.
        results = []
        errors = []
        for layer in layers:
            try:
                results.append((layer, search(layer)))
            except ToolError as e:
                errors.append(e)
        if not results:
            raise errors[0]
        found = [(layer, rows) for layer, rows in results if rows]
        layer, rows = min(found, key=lambda x: x[1][0][0]) if found else results[0]
        others = [x.get('name') for x in layers if x is not layer][:3] + [o for o in others if o != layer['name']]
        also = ' (Also searched: %s.)' % ', '.join(others[:3]) if len(layers) > 1 and others else ' (Other layers that could fit: %s.)' % ', '.join(others[:3]) if others else ''
        origin = {'place': where, 'latitude': lat, 'longitude': lon}
        if not rows:
            names = ', '.join(x['name'] for x in layers)
            return 'No %s within %s of %s.%s' % (names, feet_text(limit).replace('about ', '').replace(' away', ''), where, '' if len(layers) > 1 else also), \
                {'layer': layer['name'], 'layer_path': layer.get('path') or layer['name'], 'from': origin, 'features': []}
        ft, inside, row, name = rows[0]
        thing = singular_label(layer.get('base_name') or layer['name'])
        if inside:
            text = '%s is inside %s %s.' % (cap(where), thing, name or '')
        else:
            text = 'The closest %s to %s is %s, %s.' % (thing, where, name or 'one', feet_text(ft))
        if len(rows) > 1:
            text += ' Next: %s.' % '; '.join('%s, %s' % (r[3] or 'one', feet_text(r[0])) for r in rows[1:n])
        if len(layers) > 1:
            text += ' (In %s.)' % (layer.get('path') or layer['name'])
        return text.replace(' .', '.').replace('  ', ' ') + also, {
            'layer': layer['name'], 'layer_path': layer.get('path') or layer['name'], 'from': origin,
            'features': [r[2] for r in rows[:n]]}

    def tool_features_near(self, a, token, referer):
        layers, others = self._resolve_all(a.get('layer'))
        lat, lon, where = self._place(a, token, referer)
        feet = number(a.get('distance_feet', 500), 'distance_feet', 1, 26400)
        n = int(number(a.get('max_results', 25), 'max_results', 1, self.cfg['max_results']))
        ground = Ground(lat, lon)
        # Several layers fit the words equally ("manholes" under storm and sanitary): look in each.
        rows, errors, more = [], [], ''
        for layer in layers:
            try:
                meta, show, out = self._spatial(layer, lat, lon, feet, token, referer, count=max(n, 200))
            except ToolError as e:
                errors.append(e)
                continue
            if out.get('exceededTransferLimit'):
                more = ' or more'
            for r in self._rows(out.get('features') or [], show, ground, meta):
                if r[0] <= feet + 1:
                    if len(layers) > 1:
                        r[2]['layer'] = layer['name']
                    rows.append(r)
        if errors and not rows and len(errors) == len(layers):
            raise errors[0]
        rows.sort(key=lambda r: r[0])
        layer = layers[0]
        names = ' and '.join(x['name'] for x in layers) if len(layers) > 1 else layer['name']
        dist = '%d ft' % feet if feet < 1320 else '%s mi' % ('%g' % round(feet / 5280.0, 2))
        origin = {'place': where, 'latitude': lat, 'longitude': lon}
        if not rows:
            return 'No %s within %s of %s.' % (names, dist, where), {'layer': layer['name'], 'layer_path': layer.get('path') or layer['name'], 'from': origin, 'count': 0, 'features': []}
        if len(layers) > 1:
            # Several layers: name the thing as asked, then say where it looked.
            asked = clean_text(a.get('layer'), 60).lower()
            what = asked if len(rows) != 1 else singular_label(asked)
            searched = ' (Searched %s.)' % ', '.join(x['name'] for x in layers)
        else:
            what = layer['name'] if len(rows) != 1 else singular_label(layer.get('base_name') or layer['name'])
            searched = ''
        text = '%d%s %s within %s of %s; the closest is %s, %s.%s' % (len(rows), more, what, dist, where, rows[0][3] or 'one', feet_text(rows[0][0]), searched)
        return text, {'layer': layer['name'], 'layer_path': layer.get('path') or layer['name'], 'from': origin, 'count': len(rows), 'features': [r[2] for r in rows[:n]]}

    def tool_summarize_layer(self, a, token, referer):
        layer, others = self._resolve(a.get('layer'))
        meta = self.layers.info(layer, token, referer)
        text = clean_text(a.get('text'), 120)
        where = self._where(layer, meta, text) if text else '1=1'
        group = clean_text(a.get('group_by'), 80)
        if not group:
            return self.tool_count_features({'layer': layer['name'], 'text': text}, token, referer)
        fields = [f for f in meta.get('fields') or [] if f.get('type') not in ('esriFieldTypeGeometry', 'esriFieldTypeBlob', 'esriFieldTypeOID')]
        gw = layer_words(group)
        best, score = None, 0.0
        for f in fields:
            fw = layer_words(f['name'] + ' ' + (f.get('alias') or ''))
            s = sum(max([word_match(w, x) for x in fw] or [0]) for w in gw) / max(1, len(gw))
            if s > score:
                best, score = f, s
        if not best or score < 0.6:
            raise ToolError('%s has no field like "%s". Fields: %s.' % (layer['name'], group, ', '.join(label(f) for f in fields[:25])))
        out = self.gis.get(layer['url'] + '/query', {
            'where': where, 'groupByFieldsForStatistics': best['name'], 'returnGeometry': 'false',
            'outStatistics': json.dumps([{'statisticType': 'count', 'onStatisticField': best['name'], 'outStatisticFieldName': 'mappy_count'}])}, token, referer)
        rows = []
        for feat in out.get('features') or []:
            attrs = {k.lower(): v for k, v in (feat.get('attributes') or {}).items()}
            rows.append({label(best): value_text(best, attrs.get(best['name'].lower())) or '(blank)', 'count': int(attrs.get('mappy_count') or 0)})
        rows.sort(key=lambda r: -r['count'])
        total = sum(r['count'] for r in rows)
        if not rows:
            return 'Nothing in %s to summarize.' % layer['name'], {'layer': layer['name'], 'groups': []}
        top = ', '.join('%s %s' % (r[label(best)], format(r['count'], ',')) for r in rows[:4])
        return '%s by %s: %s features in %d groups. Most: %s.' % (layer['name'], label(best), format(total, ','), len(rows), top), \
            {'layer': layer['name'], 'field': label(best), 'total': total, 'groups': rows[:50]}

    def tool_identify(self, a, token, referer):
        lat, lon, where = self._place(a, token, referer)
        if a.get('layer'):
            # Layers that fit the words equally all count ("school": elementary, middle and high).
            targets = self._resolve_all(a.get('layer'))[0]
        else:
            # Areas first (parcel, zoning, flood zone, district): they answer "what is here" best.
            def rank(v):
                g = (self.layers.meta.get(v['url']) or {}).get('geometryType')
                return 0 if g == 'esriGeometryPolygon' else 1 if g else 2
            candidates = sorted((v for v in self.layers.by_name.values() if v.get('identify', True)), key=lambda v: (rank(v), (v.get('path') or v['name']).lower()))
            targets = candidates[:int(self.cfg.get('identify_max_layers') or 25)]
        single = bool(a.get('layer'))
        point = json.dumps({'x': lon, 'y': lat, 'spatialReference': {'wkid': 4326}})
        tol = float(self.cfg.get('identify_point_tolerance_feet') or 25)

        def one(layer):
            try:
                meta = self.layers.info(layer, token, referer)
                if not meta.get('geometryType'):
                    return None
                show = self.layers.show_fields(layer, meta)
                # One layer asked for ("who owns ...", "what zone ..."): send its shape too, to outline it.
                shape = single and meta.get('geometryType') == 'esriGeometryPolygon'
                params = {'geometry': point, 'geometryType': 'esriGeometryPoint', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
                          'outFields': ','.join(f['name'] for f in show) or '*', 'returnGeometry': 'true' if shape else 'false', 'resultRecordCount': 3}
                if shape:
                    params.update({'outSR': 4326, 'geometryPrecision': 7, 'maxAllowableOffset': 0.000005})
                if meta.get('geometryType') != 'esriGeometryPolygon':
                    params.update({'distance': tol, 'units': 'esriSRUnit_Foot'})
                out = self.gis.get(layer['url'] + '/query', params, token, referer)
                feats = out.get('features') or []
                if not feats:
                    return None
                attrs = feats[0].get('attributes') or {}
                summary = '; '.join('%s: %s' % (label(f), value_text(f, attrs.get(f['name']))) for f in show if attrs.get(f['name']) not in (None, ''))[:400]
                row = {'layer': layer['name'], 'layer_path': layer.get('path') or layer['name'], 'summary': summary, 'count': len(feats)}
                rings = (feats[0].get('geometry') or {}).get('rings') if shape else None
                if rings and sum(len(r) for r in rings) <= 4000:
                    row['geometry'] = {'rings': [[[round(x, 7), round(y, 7)] for x, y in r[:4000]] for r in rings[:20]], 'spatialReference': {'wkid': 4326}}
                return row
            except ToolError as e:
                # One layer asked about: a sign-in or service error is the answer, not "nothing here".
                if single:
                    errors.append(e)
                return None

        errors = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            rows = [r for r in pool.map(one, targets) if r]
        if single and not rows and errors:
            # The best match needs a sign-in this caller lacks (an internal copy of a public
            # layer): try the next layers that fit the words before giving up.
            tried = {id(t) for t in targets}
            alts = [v for sc, v, q in self.layers.resolve(clean_text(a.get('layer'), 120))[:10] if id(v) not in tried][:4]
            if alts:
                errors = []
                with ThreadPoolExecutor(max_workers=4) as pool:
                    rows = [r for r in pool.map(one, alts) if r]
                targets = alts if rows else targets
            if not rows and errors:
                raise errors[0]
        if not rows:
            if len(targets) == 1:
                return 'No %s at %s.' % (singular_label(targets[0].get('base_name') or targets[0]['name']), where), \
                    {'results': [], 'layer': targets[0]['name'], 'place': where, 'latitude': lat, 'longitude': lon}
            return 'Nothing from %d layers at %s.' % (len(targets), where), {'results': [], 'place': where, 'latitude': lat, 'longitude': lon}
        lines = '\n'.join('- **%s**: %s' % (r['layer'], r['summary'] or '(no details)') for r in rows[:12])
        head = ('At %s, %s: %s' % (where, rows[0]['layer'], rows[0]['summary'])) if len(rows) == 1 else 'At %s (%d layers):\n%s' % (where, len(rows), lines)
        return head, {'results': rows, 'place': where, 'latitude': lat, 'longitude': lon}

    # -- portal
    def tool_search_content(self, a, token, referer):
        q = clean_text(a.get('query'), 120)
        if not q:
            raise ToolError('Say what to search for.')
        n = int(number(a.get('max_results', 10), 'max_results', 1, 25))
        terms = ' '.join('"%s"' % w.replace('"', '') for w in q.split()[:8])
        out = self.gis.get(self.cfg['portal_url'] + '/sharing/rest/search', {
            'q': '%s -type:"Code Attachment" -type:"Featured Items"' % terms, 'num': n, 'sortField': 'numViews', 'sortOrder': 'desc'}, token, referer)
        rows = []
        for it in out.get('results') or []:
            rows.append({'title': it.get('title'), 'type': it.get('type'), 'owner': it.get('owner'),
                         'url': '%s/home/item.html?id=%s' % (self.cfg['portal_url'], it.get('id'))})
        return 'Found %d item%s for "%s".' % (len(rows), '' if len(rows) == 1 else 's', q), {'items': rows}


# ---------------------------------------------------------------- MCP protocol


# ---------------------------------------------------------------- upstream MCP servers (pass-through)

# Tool names that sound like they change data. A tool from another server is treated as able to
# change data when its annotations say so, or when it has none and its name sounds like this.
WRITE_NAME = re.compile(r'(^|[_\-.])(add|create|insert|update|edit|modify|delete|remove|append|truncate|overwrite|publish|unpublish|share|unshare|move|rename|set|write|apply|upload|post|patch|put|drop|grant|revoke|approve|reject|assign|execute|run[_-]?script|send)([_\-.]|$)', re.I)
CLIENT_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']


class SessionGone(Exception):
    pass


def changes_data(tool):
    """Could this tool from another server change data? Annotations first, else its name."""
    a = tool.get('annotations') or {}
    if a.get('readOnlyHint') is True:
        return False
    if a.get('destructiveHint') is True or a.get('readOnlyHint') is False:
        return True
    return bool(WRITE_NAME.search(str(tool.get('name') or '')))


def _registrable(host):
    parts = (host or '').lower().strip('.').split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else host


def read_mcp_body(body, content_type, want_id):
    """The JSON-RPC answer with this id, from a JSON body or an event stream."""
    text = body.decode('utf-8', 'replace')
    if 'text/event-stream' in (content_type or ''):
        found = None
        for block in re.split(r'\r?\n\r?\n', text):
            data = '\n'.join(line[5:].lstrip(' ') if line.startswith('data:') else '' for line in block.splitlines() if line.startswith('data:'))
            if not data:
                continue
            try:
                msg = json.loads(data)
            except ValueError:
                continue
            for m in (msg if isinstance(msg, list) else [msg]):
                if isinstance(m, dict) and m.get('id') == want_id:
                    found = m
        return found
    try:
        msg = json.loads(text or 'null')
    except ValueError:
        return None
    if isinstance(msg, list):
        return next((m for m in msg if isinstance(m, dict) and m.get('id') == want_id), None)
    return msg


class Upstream:
    """
    Another MCP server whose tools this server passes through, so apps talk to one server:
    Esri's ArcGIS Location Services MCP today, ArcGIS Enterprise or Online MCP when they ship.

    - Keys stay here: an API key is read from an environment variable and never reaches the
      browser. Or the signed-in user's own ArcGIS token is passed on (auth "user_token"), only
      to servers in your own domain, so people still only see what Portal lets them see.
    - Read-only unless allow_write is set; tools that could change data are hidden.
    - Tool names get a prefix ("esri_geocode") so they never clash with this server's own.
    - Sessions and tool lists are kept per signed-in identity and renewed when they expire.
    """

    def __init__(self, spec, cfg):
        self.name = re.sub(r'[^a-z0-9_]', '_', str(spec.get('name') or 'upstream').lower())
        self.label = spec.get('label') or self.name
        self.url = str(spec.get('url') or '')
        u = urllib.parse.urlparse(self.url)
        local = u.hostname in ('localhost', '127.0.0.1', '::1')
        if not (u.scheme == 'https' or (u.scheme == 'http' and local)):
            raise ValueError('upstream %s: url must be https (http only for localhost)' % self.name)
        self.host = u.hostname
        self.prefix = re.sub(r'[^A-Za-z0-9_]', '_', str(spec.get('prefix') if spec.get('prefix') is not None else self.name + '_'))
        self.auth = spec.get('auth') or 'none'   # none | api_key | user_token | user_or_key
        if self.auth not in ('none', 'api_key', 'user_token', 'user_or_key'):
            raise ValueError('upstream %s: auth must be none, api_key, user_token or user_or_key' % self.name)
        self.key = (os.environ.get(spec.get('api_key_env') or '') or '').strip()
        if self.auth in ('api_key', 'user_or_key') and not self.key:
            log.warning('Upstream %s: the environment variable named by api_key_env is empty or api_key_env is not set', self.name)
        # A user's Portal token only ever goes to a server in your own domain (or one you vouch for).
        portal_host = urllib.parse.urlparse(cfg.get('portal_url') or '').hostname or ''
        self.token_ok = bool(spec.get('trust_with_user_token')) or (portal_host and _registrable(portal_host) == _registrable(self.host)) or local
        if self.auth in ('user_token', 'user_or_key') and not self.token_ok:
            log.warning('Upstream %s: %s is outside the Portal domain; user tokens will not be sent (set trust_with_user_token to allow).', self.name, self.host)
        self.allow = set(spec.get('tools') or [])
        self.block = set(spec.get('exclude_tools') or [])
        self.allow_write = bool(spec.get('allow_write'))
        self.headers = {k: str(v) for k, v in (spec.get('headers') or {}).items() if re.match(r'^[A-Za-z0-9-]+$', str(k)) and k.lower() not in ('authorization', 'cookie')}
        self.timeout = float(spec.get('timeout_seconds') or cfg.get('timeout_seconds') or 20)
        self.cache_seconds = float(spec.get('cache_minutes', 10)) * 60
        self.ctx = None if cfg.get('verify_tls', True) else ssl._create_unverified_context()
        self.lock = threading.Lock()
        self.sessions = {}      # identity -> {'id': session id, 'version': protocol}
        self.tool_cache = {}    # identity -> (time, [tools as the upstream named them])
        self.seq = 0
        self.status = 'not contacted yet'
        self.server_title = ''

    def _bearer(self, token):
        user = token if (token and self.token_ok) else None
        if self.auth == 'api_key':
            return self.key or None
        if self.auth == 'user_token':
            return user
        if self.auth == 'user_or_key':
            return user or self.key or None
        return None

    @staticmethod
    def _identity(bearer):
        if not bearer:
            return 'anonymous'
        import hashlib
        return hashlib.sha256(bearer.encode('utf-8')).hexdigest()[:16]

    def _send(self, body, bearer, session=None, version=None, want_id=None):
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'User-Agent': 'gis-mcp/' + VERSION}
        headers.update(self.headers)
        if bearer:
            headers['Authorization'] = 'Bearer ' + bearer
        if session:
            headers['Mcp-Session-Id'] = session
        if version:
            headers['MCP-Protocol-Version'] = version
        req = urllib.request.Request(self.url, data=json.dumps(body).encode('utf-8'), method='POST', headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as res:
                raw = res.read(20_000_000)
                return read_mcp_body(raw, res.headers.get('Content-Type'), want_id) if want_id is not None else None, res.headers.get('Mcp-Session-Id')
        except urllib.error.HTTPError as e:
            if e.code == 404 and session:
                raise SessionGone()
            if e.code in (401, 403):
                self.status = 'needs a sign-in or key (%s)' % e.code
                raise ToolError('%s needs a sign-in or a key this server does not have (%s).' % (self.label, e.code))
            if e.code == 429:
                raise ToolError('%s is busy (too many requests). Try again in a minute.' % self.label)
            raise ToolError('%s answered %s.' % (self.label, e.code))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self.status = 'unreachable'
            raise ToolError('Could not reach %s (%s).' % (self.label, getattr(e, 'reason', e)))

    def _next_id(self):
        with self.lock:
            self.seq += 1
            return self.seq

    def _open(self, bearer):
        ident = self._identity(bearer)
        rid = self._next_id()
        msg, sid = self._send({'jsonrpc': '2.0', 'id': rid, 'method': 'initialize', 'params': {
            'protocolVersion': CLIENT_PROTOCOLS[0], 'capabilities': {},
            'clientInfo': {'name': 'gis-mcp', 'title': 'City GIS (gis-mcp)', 'version': VERSION}}}, bearer, want_id=rid)
        if not msg or msg.get('error'):
            raise ToolError('%s would not start a session: %s' % (self.label, ((msg or {}).get('error') or {}).get('message') or 'no answer'))
        result = msg.get('result') or {}
        version = str(result.get('protocolVersion') or CLIENT_PROTOCOLS[1])
        if version not in CLIENT_PROTOCOLS:
            raise ToolError('%s speaks MCP %s, which this server does not know yet.' % (self.label, version))
        self.server_title = (result.get('serverInfo') or {}).get('title') or (result.get('serverInfo') or {}).get('name') or ''
        self._send({'jsonrpc': '2.0', 'method': 'notifications/initialized'}, bearer, sid, version)
        with self.lock:
            self.sessions[ident] = {'id': sid, 'version': version}
        return self.sessions[ident]

    def rpc(self, method, params, token):
        bearer = self._bearer(token)
        if self.auth in ('api_key',) and not bearer:
            raise ToolError('%s has no API key set on the server.' % self.label)
        ident = self._identity(bearer)
        for attempt in (0, 1):
            sess = self.sessions.get(ident) or self._open(bearer)
            rid = self._next_id()
            try:
                msg, _ = self._send({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params}, bearer, sess.get('id'), sess.get('version'), want_id=rid)
            except SessionGone:
                with self.lock:
                    self.sessions.pop(ident, None)
                if attempt:
                    raise ToolError('%s keeps dropping the session.' % self.label)
                continue
            if not msg:
                raise ToolError('%s sent an answer that could not be read.' % self.label)
            if msg.get('error'):
                raise ToolError('%s: %s' % (self.label, msg['error'].get('message') or msg['error'].get('code')))
            self.status = 'ok'
            return msg.get('result') or {}
        raise ToolError('%s did not answer.' % self.label)

    def _usable(self, tool):
        name = str(tool.get('name') or '')
        if not name or name in self.block or (self.allow and name not in self.allow):
            return False
        return self.allow_write or not changes_data(tool)

    def raw_tools(self, token):
        ident = self._identity(self._bearer(token))
        hit = self.tool_cache.get(ident)
        if hit and time.time() - hit[0] < self.cache_seconds:
            return hit[1]
        tools, cursor = [], None
        for _ in range(20):
            r = self.rpc('tools/list', {'cursor': cursor} if cursor else {}, token)
            tools.extend(t for t in (r.get('tools') or []) if isinstance(t, dict))
            cursor = r.get('nextCursor')
            if not cursor:
                break
        tools = [t for t in tools if self._usable(t)]
        self.tool_cache[ident] = (time.time(), tools)
        return tools

    def definitions(self, token):
        out = []
        for t in self.raw_tools(token):
            d = dict(t)
            d['name'] = self.prefix + t['name']
            d['description'] = '%s (from %s)' % ((t.get('description') or t.get('title') or t['name']).strip(), self.label)
            if t.get('title'):
                d['title'] = t['title']
            if 'inputSchema' not in d or not isinstance(d.get('inputSchema'), dict):
                d['inputSchema'] = {'type': 'object', 'properties': {}}
            out.append(d)
        return out

    def owns(self, name):
        return str(name).startswith(self.prefix)

    def call(self, name, args, token):
        real = str(name)[len(self.prefix):]
        if not any(t.get('name') == real for t in self.raw_tools(token)):
            raise ToolError('%s has no tool called %s that this server passes through.' % (self.label, real))
        result = self.rpc('tools/call', {'name': real, 'arguments': args}, token)
        if not isinstance(result.get('content'), list):
            result['content'] = [{'type': 'text', 'text': json.dumps(result.get('structuredContent'), ensure_ascii=False) if result.get('structuredContent') is not None else 'Done.'}]
        return result


class Server:
    def __init__(self, cfg):
        self.cfg = cfg
        self.gis = ArcGIS(cfg)
        self.layers = Layers(cfg, self.gis)
        self.tools = Tools(cfg, self.gis, self.layers)
        self.upstreams = []
        for spec in cfg.get('upstream_servers') or []:
            if spec.get('enabled') is False:
                continue
            try:
                up = Upstream(spec, cfg)
            except ValueError as e:
                log.error('%s', e)
                continue
            if any(u.prefix == up.prefix for u in self.upstreams) or not up.prefix:
                log.error('Upstream %s: prefix "%s" is empty or already used; skipped.', up.name, up.prefix)
                continue
            self.upstreams.append(up)

    def upstream_tools(self, token):
        """Tools from every upstream server, read side by side; one that fails is left out."""
        if not self.upstreams:
            return []
        def one(up):
            try:
                return up.definitions(token)
            except ToolError as e:
                log.warning('Upstream %s tools/list: %s', up.name, e)
                return []
            except Exception:
                log.exception('Upstream %s tools/list failed', up.name)
                return []
        with ThreadPoolExecutor(max_workers=min(4, len(self.upstreams))) as pool:
            lists = list(pool.map(one, self.upstreams))
        own = {t['name'] for t in self.tools.definitions()}
        return [t for lst in lists for t in lst if t['name'] not in own]

    def handle(self, msg, token=None, referer=None):
        """One JSON-RPC message; returns the response dict, or None for notifications."""
        if not isinstance(msg, dict) or msg.get('jsonrpc') != '2.0' or not isinstance(msg.get('method'), str):
            return {'jsonrpc': '2.0', 'id': msg.get('id') if isinstance(msg, dict) else None, 'error': {'code': -32600, 'message': 'Invalid request'}}
        method = msg['method']
        params = msg.get('params') or {}
        is_note = 'id' not in msg
        try:
            result = self.dispatch(method, params, token, referer)
        except RpcError as e:
            return None if is_note else {'jsonrpc': '2.0', 'id': msg.get('id'), 'error': {'code': e.code, 'message': e.message}}
        except Exception as e:  # never leak a stack trace to the client
            log.exception('Unexpected error in %s', method)
            return None if is_note else {'jsonrpc': '2.0', 'id': msg.get('id'), 'error': {'code': -32603, 'message': 'Internal error'}}
        return None if is_note else {'jsonrpc': '2.0', 'id': msg.get('id'), 'result': result}

    def dispatch(self, method, params, token, referer):
        if method == 'initialize':
            asked = params.get('protocolVersion')
            version = asked if asked in SUPPORTED_PROTOCOLS else LATEST_PROTOCOL
            return {'protocolVersion': version, 'capabilities': {'tools': {'listChanged': False}},
                    'serverInfo': {'name': 'gis-mcp', 'title': self.cfg.get('name') or 'City GIS', 'version': VERSION},
                    'instructions': (self.cfg.get('instructions') or '') + (' Also passes through tools from: %s.' % ', '.join(u.label for u in self.upstreams) if self.upstreams else '')}
        if method.startswith('notifications/'):
            return {}
        if method == 'ping':
            return {}
        if method == 'tools/list':
            self.layers.refresh(token, referer=referer)
            return {'tools': self.tools.definitions() + self.upstream_tools(token)}
        if method == 'tools/call':
            name = params.get('name')
            args = params.get('arguments') or {}
            started = time.time()
            up = next((u for u in self.upstreams if u.owns(name)), None) if name not in {t['name'] for t in self.tools.definitions()} else None
            if up:
                if not isinstance(args, dict):
                    raise RpcError(-32602, 'Arguments must be an object.')
                try:
                    result = up.call(name, args, token)
                    log.info('upstream %s %s ok %.0fms', up.name, name, (time.time() - started) * 1000)
                    return result
                except ToolError as e:
                    log.info('upstream %s %s failed %.0fms: %s', up.name, name, (time.time() - started) * 1000, e)
                    return {'content': [{'type': 'text', 'text': e.said}], 'isError': True}
            self.layers.refresh(token, referer=referer)
            try:
                text, data = self.tools.call(name, args, token, referer)
                log.info('tool %s ok %.0fms args=%s', name, (time.time() - started) * 1000, sorted(args.keys()) if isinstance(args, dict) else '?')
                return {'content': [{'type': 'text', 'text': text + '\n' + json.dumps(data, ensure_ascii=False)}], 'structuredContent': data, 'isError': False}
            except ToolError as e:
                log.info('tool %s failed %.0fms: %s', name, (time.time() - started) * 1000, e)
                return {'content': [{'type': 'text', 'text': e.said}], 'isError': True}
        if method in ('resources/list', 'prompts/list'):
            return {method.split('/')[0]: []}
        raise RpcError(-32601, 'Method not found: %s' % method)


# ---------------------------------------------------------------- HTTP (Streamable HTTP transport)

ALLOW_HEADERS = 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id'
EXPOSE_HEADERS = 'Mcp-Session-Id, WWW-Authenticate'


def create_app(cfg):
    from flask import Flask, request, Response

    server = Server(cfg)
    app = Flask(__name__)
    base = (os.environ.get('GIS_MCP_BASE_PATH') or cfg.get('base_path') or '').rstrip('/')
    allowed = set(cfg.get('allowed_origins') or [])

    def origin_ok():
        origin = (request.headers.get('Origin') or '').rstrip('/')
        # No Origin: a desktop client or server-to-server call. With an Origin: only the listed apps
        # (this also blocks DNS rebinding from other web pages).
        return (not origin) or (origin in allowed), origin

    def with_cors(res, origin):
        if origin and origin in allowed:
            res.headers['Access-Control-Allow-Origin'] = origin
            res.headers['Vary'] = 'Origin'
            res.headers['Access-Control-Allow-Headers'] = ALLOW_HEADERS
            res.headers['Access-Control-Allow-Methods'] = 'POST, GET, DELETE, OPTIONS'
            res.headers['Access-Control-Expose-Headers'] = EXPOSE_HEADERS
            res.headers['Access-Control-Max-Age'] = '600'
        res.headers['Cache-Control'] = 'no-store'
        return res

    def json_res(obj, status=200, origin=None):
        return with_cors(Response(json.dumps(obj, ensure_ascii=False), status=status, mimetype='application/json'), origin)

    def token_from_request():
        auth = request.headers.get('Authorization') or ''
        if auth.lower().startswith('bearer '):
            tok = auth[7:].strip()
            if TOKEN_SHAPE.match(tok):
                return tok
        return None

    def resource_metadata_url():
        public = (cfg.get('public_url') or request.host_url.rstrip('/') + base).rstrip('/')
        return public + '/.well-known/oauth-protected-resource'

    # OAuth protected resource metadata (RFC 9728, MCP authorization): tells MCP clients which
    # sign-in server issues tokens for this one. Only when an authorization server is configured.
    @app.route(base + '/.well-known/oauth-protected-resource', methods=['GET'])
    @app.route('/.well-known/oauth-protected-resource' + base + '/mcp', methods=['GET'])
    def protected_resource():
        servers = cfg.get('oauth_authorization_servers') or []
        if not servers:
            return json_res({'error': 'not configured'}, 404)
        public = (cfg.get('public_url') or request.host_url.rstrip('/') + base).rstrip('/')
        return json_res({'resource': public + '/mcp', 'authorization_servers': servers, 'bearer_methods_supported': ['header'],
                         'resource_name': cfg.get('name') or 'City GIS', 'scopes_supported': cfg.get('oauth_scopes') or []})

    @app.route(base + '/health', methods=['GET'])
    def health():
        return json_res({'ok': True, 'version': VERSION, 'layers': len(server.layers.by_name), 'notes': server.layers.notes[:20],
                         'upstream': [{'name': u.name, 'label': u.label, 'prefix': u.prefix, 'auth': u.auth, 'status': u.status, 'server': u.server_title} for u in server.upstreams]})

    @app.route(base + '/mcp', methods=['OPTIONS'])
    def preflight():
        ok, origin = origin_ok()
        if not ok:
            return json_res({'error': 'origin not allowed'}, 403)
        return with_cors(Response(status=204), origin)

    @app.route(base + '/mcp', methods=['GET', 'DELETE'])
    def no_stream():
        ok, origin = origin_ok()
        res = Response(status=405)
        res.headers['Allow'] = 'POST, OPTIONS'
        return with_cors(res, origin if ok else None)

    @app.route(base + '/mcp', methods=['POST'])
    def rpc():
        ok, origin = origin_ok()
        if not ok:
            log.warning('Refused origin %s', origin)
            return json_res({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Origin not allowed'}}, 403)
        version = request.headers.get('MCP-Protocol-Version')
        if version and version not in SUPPORTED_PROTOCOLS:
            return json_res({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Unsupported MCP-Protocol-Version: %s' % version}}, 400, origin)
        token = token_from_request()
        if cfg.get('require_token') and not token:
            res = json_res({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32001, 'message': 'Sign in required'}}, 401, origin)
            res.headers['WWW-Authenticate'] = ('Bearer resource_metadata="%s"' % resource_metadata_url()) if cfg.get('oauth_authorization_servers') else 'Bearer'
            return res
        try:
            body = json.loads(request.get_data(cache=False, as_text=True) or 'null')
        except ValueError:
            return json_res({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}, 400, origin)
        referer = (origin + '/') if origin else None
        if isinstance(body, list):
            if not body or len(body) > 20:
                return json_res({'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid batch'}}, 400, origin)
            out = [r for r in (server.handle(m, token, referer) for m in body) if r is not None]
            return json_res(out, 200, origin) if out else with_cors(Response(status=202), origin)
        reply = server.handle(body, token, referer)
        if reply is None:
            return with_cors(Response(status=202), origin)
        return json_res(reply, 200, origin)

    # Read the service folders in the background at start, so /health shows what was found.
    if cfg.get('service_folders') and not cfg.get('_no_startup_refresh'):
        def warm():
            try:
                server.layers.refresh(cfg.get('discovery_token') or None, force=True)
            except Exception:
                log.exception('Startup layer refresh failed')
        threading.Thread(target=warm, daemon=True).start()
    app.mcp_server = server
    return app


# ---------------------------------------------------------------- stdio transport (desktop clients)

def run_stdio(cfg):
    server = Server(cfg)
    token = os.environ.get('GIS_MCP_TOKEN') or None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            reply = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}
        else:
            reply = [r for r in (server.handle(m, token) for m in msg) if r] if isinstance(msg, list) else server.handle(msg, token)
        if reply:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + '\n')
            sys.stdout.flush()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description='In-house MCP server for ArcGIS services.')
    p.add_argument('--config', default=os.environ.get('GIS_MCP_CONFIG') or os.path.join(here, 'config.json'))
    p.add_argument('--port', type=int, default=int(os.environ.get('HTTP_PLATFORM_PORT') or 8808))
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--stdio', action='store_true', help='Speak MCP over stdin/stdout (desktop clients).')
    p.add_argument('--check', action='store_true', help='Load the config, list the layers found, and exit.')
    a = p.parse_args()
    cfg = load_config(a.config)
    setup_logging(cfg, here)
    if a.check:
        s = Server(cfg)
        s.layers.refresh(force=True)
        print('Layers (%d):' % len(s.layers.by_name))
        for n in s.layers.names():
            print('  ' + n)
        for n in s.layers.notes:
            print('Note: ' + n)
        print('Tools: ' + ', '.join(t['name'] for t in s.tools.definitions()))
        return
    if a.stdio:
        run_stdio(cfg)
        return
    app = create_app(cfg)
    log.info('gis-mcp %s listening on %s:%s', VERSION, a.host, a.port)
    try:
        from waitress import serve
        serve(app, host=a.host, port=a.port, threads=8)
    except ImportError:
        app.run(host=a.host, port=a.port, threaded=True)


if __name__ == '__main__':
    main()
