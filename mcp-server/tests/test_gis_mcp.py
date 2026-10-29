"""
test_gis_mcp.py - checks gis_mcp.py end to end against fake_arcgis.py.

    python tests/test_gis_mcp.py

Starts the fake ArcGIS server and the MCP app in this process (no network beyond localhost)
and talks to the MCP endpoint the way a browser client does.
"""
import json
import os
import sys
import threading
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import gis_mcp  # noqa: E402
import fake_arcgis  # noqa: E402
import fake_upstream  # noqa: E402

FAKE = 18899
UPSTREAM = 18898
ORIGIN = 'https://maps.example.org'
TOKEN = 'secret-token-123'


def start_fake():
    from werkzeug.serving import make_server
    srv = make_server('127.0.0.1', FAKE, fake_arcgis.app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class GisMcpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = start_fake()
        base = 'http://127.0.0.1:%d' % FAKE
        cfg = gis_mcp.load_config(None)
        cfg.update({
            'allowed_origins': [ORIGIN],
            'portal_url': base + '/portal',
            'locator_url': base + '/arcgis/rest/services/Search/GJlocator/GeocodeServer',
            'service_folders': [base + '/arcgis/rest/services/Hub'],
            'log_dir': os.path.join(HERE, '_logs')
        })
        cls.cfg = cfg
        cls.app = gis_mcp.create_app(cfg).test_client()

    @classmethod
    def tearDownClass(cls):
        cls.fake.shutdown()

    def rpc(self, method, params=None, token=None, origin=ORIGIN, rid=1, headers=None):
        h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        if origin:
            h['Origin'] = origin
        if token:
            h['Authorization'] = 'Bearer ' + token
        h.update(headers or {})
        body = {'jsonrpc': '2.0', 'method': method, 'params': params or {}}
        if rid is not None:
            body['id'] = rid
        return self.app.post('/mcp', data=json.dumps(body), headers=h)

    def call(self, name, args, token=None):
        r = self.rpc('tools/call', {'name': name, 'arguments': args}, token=token)
        self.assertEqual(r.status_code, 200, r.data)
        return r.get_json()['result']

    def test_handshake_and_cors(self):
        r = self.rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 't', 'version': '1'}})
        j = r.get_json()['result']
        self.assertEqual(j['protocolVersion'], '2025-06-18')
        self.assertEqual(r.headers['Access-Control-Allow-Origin'], ORIGIN)
        self.assertIn('Mcp-Session-Id', r.headers['Access-Control-Expose-Headers'])
        self.assertEqual(self.rpc('initialize', {'protocolVersion': '2099-01-01'}).get_json()['result']['protocolVersion'], gis_mcp.LATEST_PROTOCOL)
        self.assertEqual(self.rpc('notifications/initialized', rid=None).status_code, 202)
        pre = self.app.options('/mcp', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,mcp-protocol-version'})
        self.assertEqual(pre.status_code, 204)
        self.assertIn('authorization', pre.headers['Access-Control-Allow-Headers'])

    def test_refuses_other_sites_and_bad_versions(self):
        self.assertEqual(self.rpc('initialize', origin='https://evil.example.com').status_code, 403)
        self.assertEqual(self.rpc('tools/list', headers={'MCP-Protocol-Version': '1999-01-01'}).status_code, 400)
        self.assertEqual(self.app.get('/mcp', headers={'Origin': ORIGIN}).status_code, 405)
        bad = self.app.post('/mcp', data='{nope', headers={'Origin': ORIGIN, 'Content-Type': 'application/json'})
        self.assertEqual(bad.get_json()['error']['code'], -32700)
        self.assertEqual(self.rpc('nope/nope').get_json()['error']['code'], -32601)

    def test_tools_listed_read_only_with_layer_choices(self):
        tools = self.rpc('tools/list').get_json()['result']['tools']
        names = [t['name'] for t in tools]
        self.assertEqual(names, ['geocode', 'reverse_geocode', 'nearest_feature', 'features_near', 'identify', 'summarize_layer', 'find_features', 'count_features', 'list_layers', 'search_content'])
        self.assertTrue(all(t['annotations']['readOnlyHint'] for t in tools))
        find = next(t for t in tools if t['name'] == 'find_features')
        self.assertEqual(find['inputSchema']['properties']['layer']['enum'], ['Fire Hydrants', 'High Zone', 'Hydrant Inspections', 'Parcels', 'Sanitary - Manholes', 'Sanitary Sewer Mains', 'Sewer Manholes', 'Storm - Manholes', 'System Valves', 'Zoning'], 'MapServer copy only, no group layers, no staff layer without a token')

    def test_geocode_and_reverse(self):
        r = self.call('geocode', {'address': '250 N 5th St'})
        self.assertFalse(r['isError'])
        c = r['structuredContent']['candidates'][0]
        self.assertEqual((c['latitude'], c['longitude']), (39.0639, -108.5506))
        self.assertIn('250 N 5TH ST', self.call('reverse_geocode', {'latitude': 39.0639, 'longitude': -108.5506})['structuredContent']['address'])
        self.assertTrue(self.call('geocode', {'address': 'x'})['isError'])
        self.assertTrue(self.call('reverse_geocode', {'latitude': 999, 'longitude': 0})['isError'])

    def test_find_count_identify(self):
        f = self.call('find_features', {'layer': 'parcels', 'text': "o'brien"})['structuredContent']
        self.assertEqual(len(f['features']), 1)
        row = f['features'][0]
        self.assertEqual(row['Owner'], "O'BRIEN PAT")
        self.assertAlmostEqual(row['latitude'], 39.064, places=3)
        self.assertEqual(self.call('count_features', {'layer': 'Parcels'})['structuredContent']['count'], 2)
        self.assertEqual(self.call('count_features', {'layer': 'Parcels', 'text': 'main'})['structuredContent']['count'], 1)
        ident = self.call('identify', {'latitude': 39.064, 'longitude': -108.5505})['structuredContent']['results']
        self.assertEqual({r['layer'] for r in ident}, {'Parcels', 'Zoning'})
        zoning = next(r for r in ident if r['layer'] == 'Zoning')
        self.assertIn('Residential 4 du/ac', zoning['summary'], 'coded values shown as their names')
        self.assertEqual(self.call('identify', {'latitude': 40, 'longitude': -100})['structuredContent']['results'], [])
        self.assertTrue(self.call('find_features', {'layer': 'Nope', 'text': 'x'})['isError'])

    def test_user_token_is_passed_through(self):
        before = len(fake_arcgis.CALLS)
        self.call('find_features', {'layer': 'Parcels', 'text': 'doe'}, token=TOKEN)
        mine = fake_arcgis.CALLS[before:]
        self.assertTrue(all(c['token'] == TOKEN for c in mine))
        self.assertTrue(all(c['referer'] == ORIGIN + '/' for c in mine))
        # A token one server does not know: public data still answers (retried without it)...
        lock = self.app.application.mcp_server.layers.reading
        lock.acquire(timeout=10)
        lock.release()
        before = len(fake_arcgis.CALLS)
        ok = self.call('find_features', {'layer': 'Parcels', 'text': 'doe'}, token='wrong-token-000')
        self.assertFalse(ok['isError'])
        # The query that answered went without the token (a background re-read may also run).
        queries = [c for c in fake_arcgis.CALLS[before:] if c.get('where')]
        self.assertTrue(queries and queries[-1]['token'] is None)

    def test_sql_is_escaped(self):
        before = len(fake_arcgis.CALLS)
        self.call('find_features', {'layer': 'Parcels', 'text': "x' OR 1=1 --"})
        where = [c['where'] for c in fake_arcgis.CALLS[before:] if c['where']][0]
        self.assertIn("LIKE '%X''%'", where)
        self.assertEqual(where.count("'") % 2, 0, 'quotes stay balanced')

    def test_portal_search_and_batch(self):
        items = self.call('search_content', {'query': 'zoning'})['structuredContent']['items']
        self.assertEqual(items[0]['title'], 'Zoning Map')
        h = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        batch = [{'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}, {'jsonrpc': '2.0', 'method': 'notifications/initialized'}]
        out = self.app.post('/mcp', data=json.dumps(batch), headers=h).get_json()
        self.assertEqual(out, [{'jsonrpc': '2.0', 'id': 1, 'result': {}}])

    def test_secured_folder_read_on_first_signed_in_request(self):
        cfg = dict(self.cfg, _no_startup_refresh=True, refresh_minutes=0.00001)
        cfg['service_folders'] = ['http://127.0.0.1:%d/arcgis/rest/services/Secure' % FAKE]
        client = gis_mcp.create_app(cfg).test_client()
        h = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
        first = client.post('/mcp', data=body, headers=h).get_json()['result']['tools']
        find0 = next(t for t in first if t['name'] == 'find_features')
        self.assertNotIn('enum', find0['inputSchema']['properties']['layer'], 'listed before names are known, so clients never cache a list without it')
        self.assertIn('nearest_feature', [t['name'] for t in first])
        signed = client.post('/mcp', data=body, headers=dict(h, Authorization='Bearer ' + TOKEN)).get_json()['result']['tools']
        find = next(t for t in signed if t['name'] == 'find_features')
        self.assertIn('Parcels', find['inputSchema']['properties']['layer']['enum'])
        # An hourly re-read without a sign-in must not wipe what the signed-in read found.
        anon = client.post('/mcp', data=body, headers=h).get_json()['result']['tools']
        find2 = next(t for t in anon if t['name'] == 'find_features')
        self.assertIn('Parcels', find2['inputSchema']['properties']['layer'].get('enum', []))

    def test_plain_words_find_layers(self):
        call = lambda words: self.call('nearest_feature', {'layer': words, 'address': '250 N 5th St'})['structuredContent']['layer']
        self.assertEqual(call('sewer line'), 'Sanitary Sewer Mains')
        self.assertEqual(call('sewer lien'), 'Sanitary Sewer Mains', 'typo')
        self.assertEqual(call('sewer pipes'), 'Sanitary Sewer Mains')
        self.assertEqual(call('manhole'), 'Sewer Manholes')
        self.assertEqual(call('sanitary manholes'), 'Sanitary - Manholes', 'a layer named with the exact words beats a synonym')
        self.assertTrue(self.call('nearest_feature', {'layer': 'bananas', 'address': '250 N 5th St'})['isError'])
        self.assertTrue(self.call('identify', {'layer': 'flood zone', 'address': '250 N 5th St'})['isError'], 'flood zone is not Zoning')

    def test_nearest_feature(self):
        r = self.call('nearest_feature', {'layer': 'sewer line', 'address': '250 N 5th St'})
        self.assertFalse(r['isError'], r)
        text = r['content'][0]['text']
        self.assertIn('The closest sanitary sewer main to 250 N 5th St is SM-101, about 75 ft away', text)
        rows = r['structuredContent']['features']
        self.assertEqual([x['Facility ID'] for x in rows], ['SM-101', 'SM-202', 'SM-303'], 'grows the search until it has enough')
        self.assertLess(abs(rows[0]['latitude'] - 39.0641), 1e-5, 'closest spot on the line')
        self.assertAlmostEqual(rows[0]['longitude'], -108.5506, places=5)
        one = self.call('nearest_feature', {'layer': 'manholes', 'latitude': 39.0639, 'longitude': -108.5506, 'max_results': 1})
        self.assertIn('MH-1', one['content'][0]['text'])
        self.assertTrue(self.call('nearest_feature', {'layer': 'sewer', 'address': 'nowhere at all'})['isError'])
        self.assertTrue(self.call('nearest_feature', {'layer': 'sewer'})['isError'], 'needs a place')
        inside = self.call('nearest_feature', {'layer': 'parcels', 'address': '250 N 5th St'})['content'][0]['text']
        self.assertIn('250 N 5th St is inside parcel', inside)

    def test_features_near_and_summary(self):
        r = self.call('features_near', {'layer': 'sewer mains', 'address': '250 N 5th St', 'distance_feet': 1000})['structuredContent']
        self.assertEqual(r['count'], 2)
        none = self.call('features_near', {'layer': 'sewer mains', 'address': '250 N 5th St', 'distance_feet': 20})
        self.assertIn('No Sanitary Sewer Mains within 20 ft', none['content'][0]['text'])
        s = self.call('summarize_layer', {'layer': 'sewer line', 'group_by': 'material'})
        self.assertEqual(s['structuredContent']['groups'][0], {'Material': 'PVC', 'count': 2})
        self.assertIn('Sanitary Sewer Mains by Material: 3 features', s['content'][0]['text'])
        self.assertTrue(self.call('summarize_layer', {'layer': 'sewer line', 'group_by': 'zzzz'})['isError'])

    def test_features_near_searches_every_matching_layer(self):
        r = self.call('features_near', {'layer': 'manholes', 'address': '250 N 5th St', 'distance_feet': 1000})
        self.assertFalse(r['isError'], r)
        data = r['structuredContent']
        self.assertEqual(data['count'], 2)
        self.assertEqual({f['layer'] for f in data['features']}, {'Sewer Manholes'})
        self.assertIn('2 manholes within 1000 ft of 250 N 5th St', r['content'][0]['text'])
        self.assertIn('Searched', r['content'][0]['text'])

    def test_identify_by_address(self):
        r = self.call('identify', {'address': '250 N 5th St'})
        self.assertFalse(r['isError'], r)
        self.assertIn('At 250 N 5th St', r['content'][0]['text'])
        z = self.call('identify', {'address': '250 N 5th St', 'layer': 'zoning'})['structuredContent']['results']
        self.assertEqual([x['layer'] for x in z], ['Zoning'])
        owner = self.call('identify', {'address': '250 N 5th St', 'layer': 'parcel'})['structuredContent']['results'][0]
        self.assertEqual(owner['layer'], 'Parcels')
        self.assertIn('Owner: DOE JANE', owner['summary'])
        self.assertEqual(owner['geometry']['rings'][0][0], [-108.551, 39.0635], 'the parcel shape comes back to outline it')
        self.assertNotIn('geometry', self.call('identify', {'address': '250 N 5th St'})['structuredContent']['results'][0], 'not for the whole report')

    def test_nested_layers_any_depth(self):
        rows = self.call('list_layers', {})['structuredContent']['layers']
        paths = {r['name']: r['path'] for r in rows}
        self.assertEqual(paths['System Valves'], 'Utility > Water > Valves > System Valves', 'three levels deep')
        self.assertEqual(paths['Storm - Manholes'], 'Utility > Storm > Manholes')
        self.assertEqual(paths['Sanitary - Manholes'], 'Utility > Sanitary > Manholes')
        self.assertEqual(paths['High Zone'], 'Utility > Pressure Zones > High Zone', 'subtype group parent left out, child kept')
        self.assertNotIn('Water', paths)
        self.assertNotIn('Pressure Zones', paths)
        layer = lambda w: self.call('nearest_feature', {'layer': w, 'address': '250 N 5th St'})['structuredContent']
        self.assertEqual(layer('storm manhole')['layer'], 'Storm - Manholes', 'group words pick between same-named layers')
        self.assertEqual(layer('sanitary manholes')['layer'], 'Sanitary - Manholes')
        self.assertEqual(layer('valves')['layer'], 'System Valves')
        h = layer('hydrant')
        self.assertEqual(h['layer'], 'Fire Hydrants')
        self.assertEqual(h['layer_path'], 'Utility > Water > Fire Hydrants')
        self.assertEqual(h['features'][0]['Facility ID'], 'FH-9', 'field names made readable')

    def test_services_root_reads_every_folder(self):
        cfg = dict(self.cfg, service_folders=['http://127.0.0.1:%d/arcgis/rest/services' % FAKE])
        client = gis_mcp.create_app(cfg).test_client()
        h = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'list_layers', 'arguments': {}}})
        names = [r['name'] for r in client.post('/mcp', data=body, headers=h).get_json()['result']['structuredContent']['layers']]
        self.assertIn('System Valves', names)
        self.assertIn('Parcels', names)

    def test_stale_names_reread_once_in_background(self):
        cfg = dict(self.cfg, refresh_minutes=0.00001)
        client = gis_mcp.create_app(cfg).test_client()
        h = {'Content-Type': 'application/json', 'Origin': ORIGIN}
        body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
        client.post('/mcp', data=body, headers=h)
        time.sleep(0.5)
        before = len([c for c in fake_arcgis.CALLS if c['path'].endswith('/Hub')])
        started = time.time()
        for _ in range(10):
            self.assertEqual(client.post('/mcp', data=body, headers=h).status_code, 200)
        self.assertLess(time.time() - started, 3, 'answers do not wait for the folder read')
        time.sleep(0.5)
        reads = len([c for c in fake_arcgis.CALLS if c['path'].endswith('/Hub')]) - before
        self.assertLessEqual(reads, 3, 'one read at a time, not one per request')
        # Let the background read finish so it does not mix into later tests.
        lock = client.application.mcp_server.layers.reading
        lock.acquire(timeout=10)
        lock.release()

    def test_require_token(self):
        cfg = dict(self.cfg, require_token=True)
        app = gis_mcp.create_app(cfg).test_client()
        r = app.post('/mcp', data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}), headers={'Content-Type': 'application/json', 'Origin': ORIGIN})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.headers.get('WWW-Authenticate'), 'Bearer')

    def test_upstream_pass_through(self):
        """Tools from another MCP server (Esri's, say) come through this one, read-only, keys kept here."""
        from werkzeug.serving import make_server
        srv = make_server('127.0.0.1', UPSTREAM, fake_upstream.app, threaded=True)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            os.environ['TEST_ESRI_KEY'] = 'AAPK-server-side-key'
            url = 'http://127.0.0.1:%d/mcp' % UPSTREAM
            cfg = dict(self.cfg, _no_startup_refresh=True, upstream_servers=[
                {'name': 'esri', 'label': 'ArcGIS Location Services', 'url': url, 'auth': 'api_key', 'api_key_env': 'TEST_ESRI_KEY', 'prefix': 'esri_'},
                {'name': 'enterprise', 'label': 'ArcGIS Enterprise', 'url': url, 'auth': 'user_token', 'prefix': 'ent_', 'tools': ['geocode']},
                {'name': 'bad', 'url': 'http://example.com/mcp'}])
            client = gis_mcp.create_app(cfg).test_client()
            h = {'Content-Type': 'application/json', 'Origin': ORIGIN, 'Authorization': 'Bearer ' + TOKEN}
            def rpc(method, params, rid=1):
                return client.post('/mcp', data=json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params}), headers=h).get_json()
            names = [t['name'] for t in rpc('tools/list', {})['result']['tools']]
            self.assertIn('esri_geocode', names)
            self.assertIn('esri_solve_route', names, 'second page of tools is read')
            self.assertNotIn('esri_delete_features', names, 'tools that change data are hidden')
            self.assertIn('esri_list_items', names)
            self.assertEqual([n for n in names if n.startswith('ent_')], ['ent_geocode'], 'allow list')
            self.assertIn('geocode', names, 'own tools keep their names')
            r = rpc('tools/call', {'name': 'esri_geocode', 'arguments': {'singleLine': '250 N 5th St'}})['result']
            self.assertFalse(r.get('isError'))
            self.assertEqual(r['structuredContent']['candidates'][0]['address'], '250 N 5th St')
            self.assertIn('Bearer AAPK-server-side-key', fake_upstream.STATE['seen_auth'], 'the key is added here, never by the browser')
            rpc('tools/call', {'name': 'ent_geocode', 'arguments': {'singleLine': 'x'}})
            self.assertIn('Bearer ' + TOKEN, fake_upstream.STATE['seen_auth'], 'the user token goes to a server in our own domain')
            fake_upstream.STATE['drop_next'] = True
            r = rpc('tools/call', {'name': 'esri_geocode', 'arguments': {'singleLine': 'again'}})['result']
            self.assertFalse(r.get('isError'), 'an expired session is renewed once')
            r = rpc('tools/call', {'name': 'esri_delete_features', 'arguments': {}})['result']
            self.assertTrue(r.get('isError'))
            health = client.get('/health').get_json()
            self.assertEqual([u['name'] for u in health['upstream']], ['esri', 'enterprise'], 'http to a non-local host is refused')
            self.assertEqual(health['upstream'][0]['status'], 'ok')
            lock = client.application.mcp_server.layers.reading
            lock.acquire(timeout=10)
            lock.release()
        finally:
            srv.shutdown()

    def test_oauth_metadata_only_when_configured(self):
        app = gis_mcp.create_app(dict(self.cfg, _no_startup_refresh=True)).test_client()
        self.assertEqual(app.get('/.well-known/oauth-protected-resource').status_code, 404)
        cfg = dict(self.cfg, _no_startup_refresh=True, require_token=True, public_url='https://gis.example.org/gis-mcp', oauth_authorization_servers=['https://portal.example.org/portal/sharing/rest'])
        app = gis_mcp.create_app(cfg).test_client()
        meta = app.get('/.well-known/oauth-protected-resource').get_json()
        self.assertEqual(meta['resource'], 'https://gis.example.org/gis-mcp/mcp')
        r = app.post('/mcp', data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}), headers={'Content-Type': 'application/json', 'Origin': ORIGIN})
        self.assertIn('resource_metadata="https://gis.example.org/gis-mcp/.well-known/oauth-protected-resource"', r.headers['WWW-Authenticate'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
