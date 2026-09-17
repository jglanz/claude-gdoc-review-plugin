import { identity } from "lodash"
import { match, P } from "ts-pattern"

import { getValue, isRecord, isString } from "../utils/index.js"

/** Constants of the tool-response reader. */
export namespace ToolResponseText {
  /** Index of the content block a structured MCP response carries its text in. */
  export const FirstContentIndex = 0
}

function stringifyResponse(response: unknown): string {
  return getValue(() => JSON.stringify(response), null)
}

function readContentText(response: Record<string, unknown>): string {
  const { content } = response
  if (!Array.isArray(content) || content.length === 0) {
    return null
  }
  const first = content[ToolResponseText.FirstContentIndex]
  return isRecord(first) && isString(first.text) ? first.text : null
}

function readRecordText(response: unknown): string {
  if (!isRecord(response)) {
    return stringifyResponse(response)
  }
  const { result } = response
  if (isString(result)) {
    return result
  }
  const contentText = readContentText(response)
  return contentText == null ? stringifyResponse(response) : contentText
}

/**
 * Reads the text of a tool response. Claude Code hands a hook whatever the
 * tool returned: the plain text of a text tool, an MCP envelope carrying
 * `result` or `content[0].text`, or an arbitrary object — which is serialized
 * so the plugin's text parsers still see the labelled lines.
 *
 * @param response `tool_response` exactly as the hook payload carried it.
 * @returns The response text, or `null` when there is nothing to read.
 */
export function readToolResponseText(response: unknown): string {
  return match(response)
    .with(P.nullish, () => null)
    .with(P.string, identity)
    .otherwise(readRecordText)
}
