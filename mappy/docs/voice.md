# A natural voice for "Read answers aloud"

Mappy can read his answers aloud. Out of the box he uses the best voice on the person's own computer. For one good voice that sounds the same for everyone, the
GIS server can do the talking with an open-source model. With the server voice, nothing goes to an outside service.

| | Browser voice | Browser's online voices | Server voice |
| --- | --- | --- | --- |
| What speaks | The person's own computer | The browser maker's service (Microsoft for Edge, Google for Chrome) | Kokoro, an open-source model, on your GIS server |
| How it sounds | Plain on Windows, better on a Mac | Natural | Natural, and the same for everyone |
| Setup | None | One switch in settings | About 15 minutes on the server, once |
| Where the words go | Nowhere | To Microsoft or Google, to be spoken | Your own server, nowhere else |

Choose in the widget's settings, under **Voice**. "Hear it" plays a sentence with the choice as
it stands.

## Browser voice

Nothing to set up. He uses only voices that speak on the person's own computer unless you turn on **Allow online voices**. With it on he may use Microsoft Edge's "Natural" voices and Chrome's Google voices, which sound much better; the browser sends each answer's words to Microsoft or Google to make the sound, so leave it off where answers should not leave your network. In settings you can prefer one voice by name; where a person's browser does
not have it, he uses the most natural one it does have. He reads the answer itself (no symbols,
links or asides), a sentence at a time.

## Server voice (gis-mcp 1.14 or later)

The model is [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), run through the
[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) package (MIT). It needs no graphics
card.

1. **Install the package** into the same Python that runs gis-mcp.
   Program: Command Prompt or PowerShell on the GIS server, Run as administrator if that Python
   is installed for all users.
   `python -m pip install -r requirements-voice.txt`
2. **Download two files** into a `voice` folder beside `gis_mcp.py` (about 140 MB together):
   - `kokoro-v1.0.int8.onnx` from <https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx>
   - `voices-v1.0.bin` from <https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin>
3. **Test it** before touching the web server.
   Program: Command Prompt, regular, in the gis-mcp folder.
   `python gis_mcp.py --say "Eight parcels match." --out test.wav`
   Open `test.wav` and listen. The command prints how long it took.
4. **Turn it on** in `config.json`:
   ```json
   "voice": { "enabled": true, "voice": "af_heart" }
   ```
5. **Recycle** the gis-mcp application pool, then open `/health`. It shows
   `"voice": { "status": "ready" }`.
6. **In the widget's settings**, under Voice, choose "One voice from my GIS server", press
   "Check the server's voice", then "Hear it".

### Settings (`voice` in config.json)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | false | Turns the voice on |
| `model`, `voices` | `voice/kokoro-v1.0.int8.onnx`, `voice/voices-v1.0.bin` | The two files; paths are beside `gis_mcp.py` unless absolute |
| `voice` | `af_heart` | The voice when the widget does not ask for one. `python gis_mcp.py --say "hi"` lists the names (af_ and am_ are American women and men, bf_ and bm_ British) |
| `speed` | 1.0 | 0.6 to 1.6 |
| `max_chars` | 600 | Longest text for one request (the widget sends a sentence at a time) |
| `per_person_per_hour` | 400 | Sentences per address per hour |
| `cache_items` | 200 | Sentences kept in memory, so "Okay" is only made once |
| `require_token` | false | Only signed-in people may use the voice |

### What to expect

- **Speed.** One sentence takes about as long to make as to say on a small machine, less on a
  server with more cores. The widget asks for the next sentence while one is playing, so only
  the first one is waited for. The larger `kokoro-v1.0.onnx` (about 310 MB) can be faster on
  some processors; point `model` at it to try.
- **Load.** The model uses every core while it speaks and handles one sentence at a time.
  A few people reading aloud at once is fine; a room full of them will queue.
- **If it fails,** the widget quietly uses the browser's voice for five minutes, then tries the
  server again.
- **Privacy.** The sentence is sent to your GIS server over the same address as the MCP
  endpoint, turned into sound there and returned. It is not written to the log (only its length
  and timing are).
