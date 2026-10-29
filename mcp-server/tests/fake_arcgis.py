"""
fake_arcgis.py - a small stand-in for ArcGIS Enterprise REST endpoints, for testing gis_mcp.py
without a real server. Serves a "Hub" folder with a Parcels/Zoning MapServer (also published as
a FeatureServer, which gis_mcp should skip), a locator and a Portal search. Requests carrying
token "secret-token-123" see a staff-only layer too.
"""
import json
import re
import sys
from flask import Flask, request, jsonify

app = Flask(__name__)
CALLS = []
GOOD = 'secret-token-123'

FIELDS_PARCELS = [
    {'name': 'OBJECTID', 'type': 'esriFieldTypeOID', 'alias': 'OBJECTID'},
    {'name': 'PARCEL_NUM', 'type': 'esriFieldTypeString', 'alias': 'Parcel Number'},
    {'name': 'OWNER', 'type': 'esriFieldTypeString', 'alias': 'Owner'},
    {'name': 'SITUS', 'type': 'esriFieldTypeString', 'alias': 'Address'},
    {'name': 'ACRES', 'type': 'esriFieldTypeDouble', 'alias': 'Acres'},
    {'name': 'Shape', 'type': 'esriFieldTypeGeometry', 'alias': 'Shape'}
]
FIELDS_ZONING = [
    {'name': 'OBJECTID', 'type': 'esriFieldTypeOID'},
    {'name': 'ZONE', 'type': 'esriFieldTypeString', 'alias': 'Zone', 'domain': {'type': 'codedValue', 'codedValues': [{'code': 'R-4', 'name': 'Residential 4 du/ac'}]}},
    {'name': 'ORD', 'type': 'esriFieldTypeString', 'alias': 'Ordinance'}
]
PARCELS = [
    {'OBJECTID': 1, 'PARCEL_NUM': '2945-144-11-002', 'OWNER': 'DOE JANE', 'SITUS': '250 N 5TH ST', 'ACRES': 0.21},
    {'OBJECTID': 2, 'PARCEL_NUM': '2945-123-00-001', 'OWNER': "O'BRIEN PAT", 'SITUS': '123 MAIN ST', 'ACRES': 0.5}
]
RING = [[-108.5510, 39.0635], [-108.5500, 39.0635], [-108.5500, 39.0645], [-108.5510, 39.0645], [-108.5510, 39.0635]]


def p(name, default=None):
    return request.values.get(name, default)


@app.before_request
def record():
    CALLS.append({'path': request.path, 'token': p('token'), 'referer': request.headers.get('Referer'), 'where': p('where')})
    if p('token') and p('token') != GOOD:
        return jsonify({'error': {'code': 498, 'message': 'Invalid token.'}})
    if '/Land/MapServer/3/' in request.path and not p('token'):
        return jsonify({'error': {'code': 499, 'message': 'Token Required'}})


@app.route('/calls')
def calls():
    return jsonify(CALLS)


@app.route('/arcgis/rest/services/Secure', methods=['GET', 'POST'])
def secure_folder():
    if p('token') != GOOD:
        return jsonify({'error': {'code': 499, 'message': 'Token Required'}})
    return jsonify({'services': [{'name': 'Hub/Land', 'type': 'MapServer'}]})


@app.route('/arcgis/rest/services/Hub', methods=['GET', 'POST'])
def folder():
    return jsonify({'services': [{'name': 'Hub/Land', 'type': 'MapServer'}, {'name': 'Hub/Land', 'type': 'FeatureServer'}, {'name': 'Hub/Imagery', 'type': 'ImageServer'},
                                 {'name': 'Hub/Sewer', 'type': 'MapServer'}, {'name': 'Hub/Utility', 'type': 'MapServer'}], 'folders': []})


@app.route('/arcgis/rest/services', methods=['GET', 'POST'])
def root():
    return jsonify({'folders': ['Hub', 'System'], 'services': []})


@app.route('/arcgis/rest/services/System', methods=['GET', 'POST'])
def system():
    raise AssertionError('System folder should be skipped')


# Nested groups three deep, a same-named layer in two groups, a subtype group parent, a table.
UTILITY = {'layers': [
    {'id': 0, 'name': 'Water', 'type': 'Group Layer', 'subLayers': [{'id': 1}, {'id': 2}]},
    {'id': 1, 'name': 'Fire Hydrants', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'parentLayer': {'id': 0}, 'displayField': 'FACILITYID', 'fields': [{'name': 'FACILITYID', 'type': 'esriFieldTypeString'}]},
    {'id': 2, 'name': 'Valves', 'type': 'Group Layer', 'parentLayer': {'id': 0}, 'subLayers': [{'id': 3}]},
    {'id': 3, 'name': 'System Valves', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'parentLayer': {'id': 2}, 'fields': [{'name': 'FACILITYID', 'type': 'esriFieldTypeString'}]},
    {'id': 4, 'name': 'Storm', 'type': 'Group Layer', 'subLayers': [{'id': 5}]},
    {'id': 5, 'name': 'Manholes', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'parentLayer': {'id': 4}, 'fields': [{'name': 'FACILITYID', 'type': 'esriFieldTypeString'}]},
    {'id': 6, 'name': 'Sanitary', 'type': 'Group Layer', 'subLayers': [{'id': 7}]},
    {'id': 7, 'name': 'Manholes', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'parentLayer': {'id': 6}, 'fields': [{'name': 'FACILITYID', 'type': 'esriFieldTypeString'}]},
    {'id': 8, 'name': 'Pressure Zones', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPolygon', 'subLayers': [{'id': 9}]},
    {'id': 9, 'name': 'High Zone', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPolygon', 'parentLayer': {'id': 8}, 'fields': [{'name': 'ZONE', 'type': 'esriFieldTypeString'}]}],
    'tables': [{'id': 10, 'name': 'Hydrant Inspections', 'type': 'Table', 'fields': [{'name': 'NOTE', 'type': 'esriFieldTypeString'}]}]}


@app.route('/arcgis/rest/services/Hub/Utility/MapServer/layers', methods=['GET', 'POST'])
def utility_layers():
    return jsonify(UTILITY)


@app.route('/arcgis/rest/services/Hub/Utility/MapServer/<int:lid>/query', methods=['GET', 'POST'])
def utility_query(lid):
    if lid == 1 and p('geometry'):
        pt = json.loads(p('geometry'))
        g = {'x': -108.5507, 'y': 39.0640}
        if feet_between(g, pt['x'], pt['y']) <= float(p('distance') or 0):
            return jsonify({'features': [{'attributes': {'FACILITYID': 'FH-9'}, 'geometry': g}]})
    return jsonify({'features': []})


SEWER_FIELDS = [{'name': 'OBJECTID', 'type': 'esriFieldTypeOID'}, {'name': 'FACILITYID', 'type': 'esriFieldTypeString', 'alias': 'Facility ID'},
                {'name': 'MATERIAL', 'type': 'esriFieldTypeString', 'alias': 'Material'}, {'name': 'DIAMETER', 'type': 'esriFieldTypeDouble', 'alias': 'Diameter'}]
MAINS = [({'OBJECTID': 1, 'FACILITYID': 'SM-101', 'MATERIAL': 'PVC', 'DIAMETER': 8}, {'paths': [[[-108.5520, 39.0641], [-108.5490, 39.0641]]]}),
         ({'OBJECTID': 2, 'FACILITYID': 'SM-202', 'MATERIAL': 'VCP', 'DIAMETER': 10}, {'paths': [[[-108.5520, 39.0660], [-108.5490, 39.0660]]]}),
         ({'OBJECTID': 3, 'FACILITYID': 'SM-303', 'MATERIAL': 'PVC', 'DIAMETER': 8}, {'paths': [[[-108.5600, 39.0800], [-108.5590, 39.0800]]]})]
MANHOLES = [({'OBJECTID': 1, 'FACILITYID': 'MH-1', 'MATERIAL': 'CONC', 'DIAMETER': 48}, {'x': -108.5506, 'y': 39.0642}),
            ({'OBJECTID': 2, 'FACILITYID': 'MH-2', 'MATERIAL': 'CONC', 'DIAMETER': 48}, {'x': -108.5530, 'y': 39.0639})]


def feet_between(g, x, y):
    import math
    k = 364000.0 * math.cos(math.radians(y))
    if 'x' in g:
        return math.hypot((g['x'] - x) * k, (g['y'] - y) * 364000.0)
    best = 1e12
    for path in g['paths']:
        for (x1, y1), (x2, y2) in zip(path, path[1:]):
            ax, ay, bx, by = (x1 - x) * k, (y1 - y) * 364000.0, (x2 - x) * k, (y2 - y) * 364000.0
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


@app.route('/arcgis/rest/services/Hub/Sewer/MapServer/layers', methods=['GET', 'POST'])
def sewer_layers():
    return jsonify({'layers': [
        {'id': 0, 'name': 'Sanitary Sewer Mains', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPolyline', 'displayField': 'FACILITYID', 'fields': SEWER_FIELDS},
        {'id': 1, 'name': 'Sewer Manholes', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'displayField': 'FACILITYID', 'fields': SEWER_FIELDS}], 'tables': []})


@app.route('/arcgis/rest/services/Hub/Sewer/MapServer/<int:lid>/query', methods=['GET', 'POST'])
def sewer_query(lid):
    data = MAINS if lid == 0 else MANHOLES
    if p('outStatistics'):
        field = p('groupByFieldsForStatistics')
        groups = {}
        for attrs, g in data:
            groups[attrs[field]] = groups.get(attrs[field], 0) + 1
        return jsonify({'features': [{'attributes': {field: k, 'MAPPY_COUNT': v}} for k, v in groups.items()]})
    rows = data
    if p('geometry'):
        pt = json.loads(p('geometry'))
        rows = [r for r in data if feet_between(r[1], pt['x'], pt['y']) <= float(p('distance') or 0)]
    if p('returnCountOnly') == 'true':
        return jsonify({'count': len(rows)})
    return jsonify({'features': [{'attributes': a, 'geometry': g if p('returnGeometry') == 'true' else None} for a, g in rows]})


@app.route('/arcgis/rest/services/Hub/Land/MapServer/layers', methods=['GET', 'POST'])
def layers():
    out = [
        {'id': 0, 'name': 'Parcels', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPolygon', 'displayField': 'SITUS', 'fields': FIELDS_PARCELS},
        {'id': 1, 'name': 'Zoning', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPolygon', 'displayField': 'ZONE', 'fields': FIELDS_ZONING},
        {'id': 2, 'name': 'Land Group', 'type': 'Group Layer', 'subLayers': [{'id': 0}]}
    ]
    if p('token') == GOOD:
        out.append({'id': 3, 'name': 'Staff Notes', 'type': 'Feature Layer', 'geometryType': 'esriGeometryPoint', 'displayField': 'NOTE', 'fields': [{'name': 'NOTE', 'type': 'esriFieldTypeString'}]})
    return jsonify({'layers': out, 'tables': []})


@app.route('/arcgis/rest/services/Hub/Land/MapServer/<int:lid>/query', methods=['GET', 'POST'])
def query(lid):
    where = p('where', '1=1')
    if lid == 3 and p('token') != GOOD:
        return jsonify({'error': {'code': 499, 'message': 'Token Required'}})
    rows = PARCELS if lid == 0 else [{'OBJECTID': 1, 'ZONE': 'R-4', 'ORD': '4410'}] if lid == 1 else [{'NOTE': 'staff only'}]
    if p('geometry'):
        g = json.loads(p('geometry'))
        inside = -108.5510 <= g['x'] <= -108.5500 and 39.0635 <= g['y'] <= 39.0645
        rows = rows[:1] if inside else []
    else:
        words = re.findall(r"LIKE '%((?:[^']|'')*)%'", where)
        if words:
            def hit(r):
                text = ' '.join(str(v) for v in r.values()).upper()
                return all(w.replace("''", "'") in text for w in set(words))
            rows = [r for r in rows if hit(r)]
    if p('returnCountOnly') == 'true':
        return jsonify({'count': len(rows)})
    feats = [{'attributes': r, 'geometry': {'rings': [RING]} if p('returnGeometry') == 'true' else None} for r in rows]
    return jsonify({'features': feats})


@app.route('/arcgis/rest/services/Search/GJlocator/GeocodeServer/findAddressCandidates', methods=['GET', 'POST'])
def geocode():
    q = (p('SingleLine') or '').upper()
    if '5TH' in q:
        return jsonify({'candidates': [{'address': '250 N 5TH ST, GRAND JUNCTION, CO, 81501', 'score': 100, 'location': {'x': -108.5506, 'y': 39.0639}, 'attributes': {'Match_addr': '250 N 5TH ST', 'Addr_type': 'PointAddress'}}]})
    return jsonify({'candidates': []})


@app.route('/arcgis/rest/services/Search/GJlocator/GeocodeServer/reverseGeocode', methods=['GET', 'POST'])
def reverse():
    return jsonify({'address': {'Match_addr': '250 N 5TH ST, GRAND JUNCTION, CO, 81501'}, 'location': {'x': -108.5506, 'y': 39.0639}})


@app.route('/portal/sharing/rest/search', methods=['GET', 'POST'])
def search():
    return jsonify({'results': [{'id': 'abc123', 'title': 'Zoning Map', 'type': 'Web Map', 'owner': 'gis@example.org'}]})


if __name__ == '__main__':
    app.run(port=int(sys.argv[1]) if len(sys.argv) > 1 else 8899)
