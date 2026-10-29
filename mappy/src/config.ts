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
  /** Jokes, riddles, games and the hat for the time of year. Undefined means on. */
  fun?: boolean
  /** Little synthesized sounds (a pop when he arrives, a knock for a tip, a ta-da). Off unless turned on. */
  sounds?: boolean
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
  /** Usage telemetry through the shared Beacon module. Explicit opt-in only. */
  telemetry?: boolean
}

export type IMConfig = ImmutableObject<Config>
