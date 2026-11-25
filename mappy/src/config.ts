import type { ImmutableObject } from 'jimu-core'
import type { Brain } from './brain/types'
import type { FaqEntry } from './brain/admin'

export type DisplayMode = 'floating' | 'inline'
export type Corner = 'bottom-right' | 'bottom-left'
export type BubbleStyle = 'classic' | 'theme'
export type CharacterSize = 'small' | 'medium' | 'large'

export interface Config {
  /** Character name shown in the bubble and used in his lines. */
  assistantName: string
  /** First thing he says. Empty uses a built-in greeting with the app title. */
  greeting: string
  displayMode: DisplayMode
  corner: Corner
  size: CharacterSize
  bubbleStyle: BubbleStyle
  /** Open the chat with a greeting on a user's first visit. */
  greetOnFirstVisit: boolean
  /** Occasional "Did you know?" tips and "looks like you're hunting" nudges. */
  tipsEnabled: boolean
  tipIntervalSec: number
  /** Let him query map layers for features ("find 123 Main St"). */
  featureSearch: boolean
  maxResults: number
  /** Let users drag him around the screen. */
  draggable: boolean
  /** Suggestion chips under the input. Empty uses smart defaults. */
  suggestions: string[]
  /** Questions and answers typed by the app author. */
  faq: FaqEntry[]
  /** Free-form notes; each paragraph becomes one thing he knows. */
  notes: string
  /** Deep scan result: layers, fields, domains, web map details, widget docs. */
  brain?: Brain | null
  /** Marks completion of the automatic builder setup. */
  setupVersion?: number
  /** After a layer change, open the layer list (Map Layers) and flash the row. Undefined means on. */
  showInLayerList?: boolean
  /** "bulb": a light bulb appears over him when he has a tip; "pop": the bubble opens. */
  tipStyle?: 'bulb' | 'pop'
  /** Answers type themselves out (skipped under reduced motion). Undefined means on. */
  typewriter?: boolean
  /** Offer "Read answers aloud" in his menu (browser speech). Undefined means on. */
  allowReadAloud?: boolean
  /**
   * The voice for read aloud, from the browser's voices: name (a voice to prefer), online (allow the
   * browser's online voices, which send the words to its maker) and rate. See brain/speech.ts.
   */
  voice?: any
  /** Fix typos before reading a request ("trun on parcles"). Undefined means on. Turn off for apps used mostly in other languages. */
  typoFix?: boolean
  /** A newer language pack pulled in settings ("Get language updates"); used when newer than the bundled one. */
  languagePack?: any
  /**
   * An MCP server (Model Context Protocol, Streamable HTTP) whose tools Mappy can use: url,
   * label, auth ('none' | 'arcgis' | 'header'), headerName/headerValue, fallback, enabled, and
   * tools [{ name, enabled, confirm }] chosen in settings. See docs/mcp.md.
   */
  mcp?: any
  /**
   * Where he turns for help beyond the app, one choice: 'local' (the app's own layers and
   * locator only), 'mcp' (the MCP server above) or 'assistant' (an AI assistant in its own tab,
   * Claude by default). Undefined means the server when one is connected, else local.
   */
  helper?: 'local' | 'mcp' | 'assistant'
  /** The assistant for helper 'assistant': label, url ({q} is the question), prefix, context, signedInOnly. See brain/handoff.ts. */
  assistant?: any
  /** Jokes, riddles, games and the hat for the time of year. Undefined means on. */
  fun?: boolean
  /** Little synthesized sounds (a pop when he arrives, a knock for a tip, a ta-da). Off unless turned on. */
  sounds?: boolean
  /**
   * The knowledge feed: a JSON file fetched once a day with newer words and phrasings, answers,
   * glossary terms, facts and tips, so he improves without an app update. Undefined means on,
   * from the project's feed on GitHub; feedUrl points at your own copy (an internal web folder).
   */
  feed?: boolean
  feedUrl?: string
  /** Map moves jump instead of flying, for people who get motion sick. Off means follow the person's OS "reduce motion" setting (and Pause). */
  calmMap?: boolean
  /**
   * Who runs this app and where it is, so his wording fits any city, county, district or utility:
   * "the City's website" becomes "<orgName>'s website". Empty uses the portal's organization
   * name, then "the City". placeName is the town or area for his lines ("Summer in Springfield").
   */
  orgName?: string
  placeName?: string
  /** State, province or country, for finding the place's Wikipedia page ("Illinois", "France"). */
  placeRegion?: string
  /** The organization's website, offered as a link when he points people off the map. */
  website?: string
  /** Local fun facts, one per line, mixed in with the built-in map facts ("fun fact"). */
  localFacts?: string
  /** Which open sources "Build facts" reads besides Wikipedia (all when absent). */
  factSources?: string[]
  /** A free US Census API key (api.census.gov/data/key_signup.html), for Census facts. */
  censusKey?: string
  /** Facts from the app's own map layers ("The map has 2,314 fire hydrants"), worked out at runtime. Undefined means on. */
  mapFacts?: boolean
  /**
   * A real person or team to hand off to: name, email, phone, url (https), hours. Offered when
   * someone asks for a person and after two questions in a row he could not answer. See brain/care.ts.
   */
  contact?: any
  /** Usage telemetry through the shared Beacon module. Explicit opt-in only. */
  telemetry?: boolean
  /** With telemetry on: also send each question he could not answer (long numbers masked) to the usage table. Off by default. */
  telemetryMisses?: boolean
  /** "Owners within 300 ft of ..." answers with the owners' names and mailing addresses and a spreadsheet to save. Off by default. */
  notifyLists?: boolean
}

export type IMConfig = ImmutableObject<Config>
