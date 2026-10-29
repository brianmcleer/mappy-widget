"""
fake_upstream.py - a stand-in for another MCP server (Esri's ArcGIS Location Services MCP, or
ArcGIS Enterprise's own MCP when it ships) for the pass-through tests. Streamable HTTP with
sessions; answers as an event stream; one read-only tool without annotations-free write tool.
"""
import json
from flask import Flask, request, Response

app = Flask(__name__)
STATE = {'sessions': set(), 'drop_next': False, 'seen_auth': [], 'n': 0}
TOOLS = [
    {'name': 'geocode', 'title': 'Geocode', 'description': 'Find an address.', 'inputSchema': {'type': 'object', 'properties': {'singleLine': {'type': 'string'}}, 'required': ['singleLine']}, 'annotations': {'readOnlyHint': True}},
    {'name': 'solve_route', 'description': 'Driving directions.', 'inputSchema': {'type': 'object', 'properties': {'stops': {'type': 'string'}}}, 'annotations': {'readOnlyHint': True}},
    {'name': 'delete_features', 'description': 'Delete features.', 'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'list_items', 'description': 'List portal items.', 'inputSchema': {'type': 'object', 'properties': {}}}
]


def sse(obj):
    return Response('event: message\ndata: ' + json.dumps(obj) + '\n\n', mimetype='text/event-stream')


@app.route('/mcp', methods=['POST'])
def mcp():
    STATE['seen_auth'].append(request.headers.get('Authorization'))
    msg = request.get_json()
    method = msg.get('method')
    if method == 'initialize':
        STATE['n'] += 1
        sid = 'S%d' % STATE['n']
        STATE['sessions'].add(sid)
        res = sse({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fake-esri', 'title': 'Fake Location Services'}}})
        res.headers['Mcp-Session-Id'] = sid
        return res
    sid = request.headers.get('Mcp-Session-Id')
    if STATE['drop_next'] or sid not in STATE['sessions']:
        STATE['drop_next'] = False
        STATE['sessions'].discard(sid)
        return Response('gone', status=404)
    if 'id' not in msg:
        return Response(status=202)
    if method == 'tools/list':
        cursor = (msg.get('params') or {}).get('cursor')
        page = TOOLS[2:] if cursor else TOOLS[:2]
        return sse({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'tools': page, **({} if cursor else {'nextCursor': 'p2'})}})
    if method == 'tools/call':
        p = msg['params']
        if p['name'] == 'geocode':
            return sse({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'content': [{'type': 'text', 'text': 'Found it.'}], 'structuredContent': {'candidates': [{'address': p['arguments'].get('singleLine'), 'location': {'x': -108.55, 'y': 39.06}, 'score': 100}]}}})
        return sse({'jsonrpc': '2.0', 'id': msg['id'], 'error': {'code': -32602, 'message': 'no'}})
    return sse({'jsonrpc': '2.0', 'id': msg['id'], 'error': {'code': -32601, 'message': 'Method not found'}})
