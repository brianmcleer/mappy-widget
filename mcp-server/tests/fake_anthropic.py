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
    # What was asked first in this conversation (the question; later turns are tool results).
    asked = next((m['content'] for m in body['messages'] if m['role'] == 'user' and isinstance(m['content'], str)), '')
    said = lambda t, stop='end_turn': jsonify({'id': 'mx', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': stop, 'usage': USAGE, 'content': [{'type': 'text', 'text': t}] if t else []})
    forced = (body.get('tool_choice') or {}).get('type') == 'none'
    after_tools = isinstance(last['content'], list) and last['content'] and last['content'][0].get('type') == 'tool_result'
    if after_tools:
        # Every tool call in the turn before must have exactly one result, and the tool list must still be there.
        want = [b['id'] for b in body['messages'][-2]['content'] if b.get('type') == 'tool_use']
        got = [b['tool_use_id'] for b in last['content']]
        assert want == got, 'one tool_result per tool_use, in order'
        assert body.get('tools'), 'the tool list stays while tool results are in the conversation'
    if 'refuse' in asked:
        return said('', 'refusal')
    if 'truncate' in asked:
        return said('A long answer that got cut', 'max_tokens')
    if 'loop' in asked and not forced:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use', 'usage': USAGE,
                        'content': [{'type': 'tool_use', 'id': 'tu_loop%d' % len(body['messages']), 'name': 'list_layers', 'input': {}}]})
    if 'loop' in asked and forced:
        return said('Stopped looking and answered.')
    if 'many lookups' in asked and not after_tools:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use', 'usage': USAGE,
                        'content': [{'type': 'tool_use', 'id': 'tu_m%d' % i, 'name': 'list_layers', 'input': {}} for i in range(10)]})
    if 'quiet' in asked and after_tools:
        return said('')
    if 'quiet' in asked and isinstance(last['content'], str) and 'answer the question now' in last['content']:
        return said('Here it is after a nudge.')
    if after_tools:
        result = last['content'][0]['content']
        return jsonify({'id': 'm2', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'From the map data: ' + result.split('\n')[0]}]})
    if forced or 'no tools' in text:
        return jsonify({'id': 'm0', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn', 'usage': USAGE,
                        'content': [{'type': 'text', 'text': 'Hello from the fake.'}]})
    names = [t['name'] for t in body['tools']]
    assert 'ask_assistant' not in names, 'the assistant must not be offered itself'
    assert 'map_show_place' in names and body['tools'][-1].get('cache_control'), 'map tools offered, tool list cacheable'
    assert isinstance(body['system'], list) and body['system'][0].get('cache_control'), 'instructions cacheable'
    layer = 'Fire Hydrants'
    return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use',
                    'content': [{'type': 'text', 'text': 'Let me count.'}, {'type': 'tool_use', 'id': 'tu_1', 'name': 'count_features', 'input': {'layer': layer}}]})
