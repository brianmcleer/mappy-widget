"""
fake_anthropic.py - a stand-in for the Anthropic Messages API for the ask_assistant tests. The
first turn asks for count_features on the first layer it was offered; the next turn answers
with the tool result it was given. 'busy' in the question returns 529; a wrong key gets 401.
"""
import json
from flask import Flask, request, jsonify

app = Flask(__name__)
STATE = {'calls': [], 'key': 'sk-test-key'}


@app.route('/v1/messages', methods=['POST'])
def messages():
    body = request.get_json()
    STATE['calls'].append({'headers': dict(request.headers), 'body': body})
    if request.headers.get('x-api-key') != STATE['key']:
        return jsonify({'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}), 401
    first = body['messages'][-1]
    text = first['content'] if isinstance(first['content'], str) else ''
    if 'busy' in text:
        return jsonify({'type': 'error', 'error': {'type': 'overloaded_error'}}), 529
    last = body['messages'][-1]
    if isinstance(last['content'], list) and last['content'] and last['content'][0].get('type') == 'tool_result':
        result = last['content'][0]['content']
        return jsonify({'id': 'm2', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn',
                        'content': [{'type': 'text', 'text': 'From the map data: ' + result.split('\n')[0]}]})
    if 'loop' in text:
        return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use',
                        'content': [{'type': 'tool_use', 'id': 'tu_loop', 'name': 'list_layers', 'input': {}}]})
    if not body.get('tools') or 'no tools' in text:
        return jsonify({'id': 'm0', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'end_turn',
                        'content': [{'type': 'text', 'text': 'Hello from the fake.'}]})
    names = [t['name'] for t in body['tools']]
    assert 'ask_assistant' not in names, 'the assistant must not be offered itself'
    layer = 'Fire Hydrants'
    return jsonify({'id': 'm1', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'stop_reason': 'tool_use',
                    'content': [{'type': 'text', 'text': 'Let me count.'}, {'type': 'tool_use', 'id': 'tu_1', 'name': 'count_features', 'input': {'layer': layer}}]})
