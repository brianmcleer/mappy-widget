"""
fake_anthropic.py - a stand-in for the Anthropic Messages API for the ask_assistant tests. The
first turn asks for count_features on the first layer it was offered; the next turn answers
with the tool result it was given. 'busy' in the question returns 529; a wrong key gets 401.
"""
import json
from flask import Flask, request, jsonify

app = Flask(__name__)
STATE = {'calls': [], 'key': 'sk-test-key', 'flaky': 0}
USAGE = {'input_tokens': 100, 'output_tokens': 20, 'cache_read_input_tokens': 900}


@app.route('/v1/messages', methods=['POST'])
def messages():
    body = request.get_json()
    STATE['calls'].append({'headers': dict(request.headers), 'body': body})
    if request.headers.get('x-api-key') != STATE['key']:
        return jsonify({'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}), 401
    first = body['messages'][-1]
    text = first['content'] if isinstance(first['content'], str) else ''
    if body.get('model') == 'no-such-model':
        return jsonify({'type': 'error', 'error': {'type': 'not_found_error', 'message': 'model: no-such-model'}}), 404
    if isinstance(first['content'], list) and first['content'] and first['content'][0].get('type') == 'image':
        src = first['content'][0]['source']
        return jsonify({'id': 'mi', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'I can see the map picture (%s, %d characters).' % (src['media_type'], len(src['data']))}]})
    if 'busy' in text:
        return jsonify({'type': 'error', 'error': {'type': 'overloaded_error'}}), 529
    if 'flaky' in text:
        STATE['flaky'] += 1
        if STATE['flaky'] == 1:
            return jsonify({'type': 'error', 'error': {'type': 'overloaded_error'}}), 529
    if 'followups' in text:
        return jsonify({'id': 'm0', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'There are **12** parks.\n\nNext: Which is the largest? | Which have playgrounds? | x | Show them by district'}]})
    if 'chart it' in text:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use', 'usage': USAGE,
                        'content': [{'type': 'tool_use', 'id': 'tu_c', 'name': 'show_chart', 'input': {'title': 'Parcels by zoning', 'unit': 'parcels', 'rows': [{'label': 'R-4', 'value': 120}, {'label': 'R-8', 'value': '80'}, {'label': 'bad', 'value': 'x'}]}},
                                    {'type': 'tool_use', 'id': 'tu_t', 'name': 'show_table', 'input': {'columns': ['Zone', 'Count'], 'rows': [['R-4', 120], ['R-8']]}},
                                    {'type': 'tool_use', 'id': 'tu_m', 'name': 'map_suggest_command', 'input': {'command': 'chart parcels by zoning', 'label': 'Chart it on the map data'}},
                                    {'type': 'tool_use', 'id': 'tu_x', 'name': 'map_suggest_command', 'input': {'command': '__mcp:run:1', 'label': 'sneaky'}}]})
    if 'show me' in text:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use', 'usage': USAGE,
                        'content': [{'type': 'tool_use', 'id': 'tu_p', 'name': 'map_show_place', 'input': {'latitude': 39.0672, 'longitude': -108.5645, 'label': 'City Hall'}},
                                    {'type': 'tool_use', 'id': 'tu_l', 'name': 'map_show_layer', 'input': {'layer': 'Zoning'}},
                                    {'type': 'tool_use', 'id': 'tu_bad', 'name': 'map_show_place', 'input': {'latitude': 999, 'longitude': 0, 'label': 'nowhere'}}]})
    last = body['messages'][-1]
    if isinstance(last['content'], list) and last['content'] and last['content'][0].get('type') == 'tool_result':
        result = last['content'][0]['content']
        return jsonify({'id': 'm2', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'From the map data: ' + result.split('\n')[0]}]})
    if 'loop' in text:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use',
                        'content': [{'type': 'tool_use', 'id': 'tu_loop', 'name': 'list_layers', 'input': {}}]})
    if not body.get('tools') or 'no tools' in text:
        return jsonify({'id': 'm0', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'Hello from the fake.'}]})
    names = [t['name'] for t in body['tools']]
    assert 'ask_assistant' not in names, 'the assistant must not be offered itself'
    assert 'map_show_place' in names and body['tools'][-1].get('cache_control'), 'map tools offered, tool list cacheable'
    assert isinstance(body['system'], list) and body['system'][0].get('cache_control'), 'instructions cacheable'
    layer = 'Fire Hydrants'
    return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use',
                    'content': [{'type': 'text', 'text': 'Let me count.'}, {'type': 'tool_use', 'id': 'tu_1', 'name': 'count_features', 'input': {'layer': layer}}]})
