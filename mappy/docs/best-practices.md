# Chatbot best practices, and how Mappy meets them

A checklist for people deciding whether Mappy is ready for their app. The practices are the
ones chatbot guides commonly list (for example Botpress, "Chatbot best practices"). Each row
says what Mappy does and where the builder sets it.

| Practice | What Mappy does | Where |
| --- | --- | --- |
| **Customization**: connected to your own information, one consistent voice | Reads the app itself (pages, tools, layers, fields, code lists), the builder's own questions and answers and notes, and the organization and place names. One voice, with a name the builder picks. | Settings: General, Questions and answers, Your place |
| **Integration and channels**: reaches the systems that hold the answers | Works with the map's own services and locator, the app's Table and layer list widgets, and optionally a GIS server (MCP) for place questions. He lives where the map is: any Experience Builder page, desktop or phone. | Settings: Where he gets help, MCP server |
| **Privacy and security** | Runs in the browser. Queries use the person's own sign-in, so they see only what the portal allows. Usage counts are off unless turned on. Card and Social Security numbers are never sent to a server. "Privacy" and "what do you know about me" are answered plainly, and "forget everything" erases what he kept. With Claude as the helper, the API key stays on the GIS server and field names can be held back. | docs/claude.md, docs/mcp.md |
| **Human in the loop**: always a way to a real person | "Talk to a person", "report a problem" and "the data is wrong" give the builder's contact with buttons; the email carries the question. After two misses in a row he offers the person himself. | Settings: A person to ask |
| **Learning**: gets better from what he could not answer | He keeps missed questions in the browser; "what did you miss" lists them and emails them to the contact. The builder adds answers in settings. The language pack and knowledge feed update on their own, and "Report a missed phrase" sends one to the project. Thumbs on Claude's answers go to the server for review. | Settings: Questions and answers, Language, Knowledge feed |
| **Conversation flows**: asks for what he needs | When a request is missing something he asks one question: which layer, which address match, which place. "The first one", a name or "cancel" all work. Follow-ups carry on ("what about zoning", "and the next page"). | Built in |
| **Context**: uses what he already knows | The layer just used, the last place asked about, the open popup, the map's extent and scale, what he changed this session, the person's first name if they gave it, and earlier turns when Claude is helping. | Built in |
| **Actions**: does things, not only talks | Opens tools, turns layers on and off, filters, zooms, counts, charts, pages through tables, saves views, pins, measures, with Undo for what he changed. | Built in |
| **Never a dead end** | A stuck answer always carries a next step: the closest requests he does understand, the AI helper when one is set, then a person. | Built in |
| **Honest about what he is** | He says he is a program. AI answers carry a note saying so. He never invents a contact, a number or a link. | Settings: the note under AI answers |
| **Short and clear** | One answer, a few buttons, suggestions as you type. Plain words; the glossary explains terms. | Built in |
| **Accessible** | Keyboard reachable, screen reader labels on lists and charts, respects reduced motion, Pause stops all movement. | Built in |
| **Measured** | Optional anonymous usage counts (which features, errors), the missed list, diagnostics, and on the server: daily questions, tokens, cost and ratings. | Settings: Usage counts; docs/claude.md |

## The five-minute setup that covers the list

1. **A person to ask**: fill in who, an email or phone, and hours.
2. **Questions and answers**: add the five things people ask most.
3. **Your place**: organization, place name, website.
4. **Where he gets help**: this app only, your GIS server, or an AI helper.
5. After a week, open the app, say **what did you miss**, and add answers for what is there.
