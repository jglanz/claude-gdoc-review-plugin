import { GDocReview } from "../Constants.js"

/** A Google Doc created by `import_to_google_doc`, read out of the tool's text response. */
export interface ImportedDocument {
  /** Google Doc file id. */
  documentId: string
  /** Shareable document link, when the response carried one. */
  link: string
}

/** Outcome of an `update_drive_file` call. */
export interface UpdatedFile {
  /** True when the response reported the update as successful. */
  success: boolean
  /** Drive file id the update targeted, when the response carried one. */
  fileId: string
}

/** A comment created by `manage_document_comment` with action `create`. */
export interface CreatedComment {
  /** Google Docs comment id, used later as the reply/resolve target. */
  commentId: string
}

/**
 * Constants of the workspace-mcp response parsers: the labels the server
 * renders its text responses with, and the patterns that decide whether a Doc
 * reference is one of the two canonical forms.
 */
export namespace ToolResponseParsers {
  /** Label carrying the id of a newly imported Google Doc. */
  export const DocumentIdLabel = "Document ID:"

  /** Label carrying the link of a newly imported Google Doc. */
  export const LinkLabel = "Link:"

  /** Label carrying the Drive file id of an updated file. */
  export const FileIdLabel = "File ID:"

  /** Label opening a comment block, and carrying the comment id. */
  export const CommentIdLabel = "Comment ID:"

  /** Substring the server writes when a file update succeeded. */
  export const SuccessMarker = "Successfully updated"

  /** Leading part of the canonical Google Doc edit URL. */
  export const DocumentUrlPrefix = "https://docs.google.com/document/d/"

  /** Trailing part of the canonical Google Doc edit URL. */
  export const DocumentUrlSuffix = "/edit"

  /**
   * Matches a canonical Google Docs document URL and captures its file id.
   *
   * The pattern matches the WHOLE string: the scheme, the host and the id are
   * anchored, the path may only end in the canonical `/edit`, `/view` or
   * `/preview`, and a query or fragment may only carry URL characters. So a
   * URL on another host, one with the Docs address merely embedded in it
   * (`https://evil.example/?x=https://docs.google.com/document/d/<id>`), and
   * one with a prose payload hung off its tail (`…/edit#…SYSTEM NOTE: …`) are
   * all non-matches rather than references this plugin would echo back.
   *
   * The optional `u/<n>/` segment is the account selector Google puts in a link
   * copied out of a browser signed into more than one account
   * (`https://docs.google.com/u/1/document/d/<id>/edit`); it names the local
   * profile slot, never a different document, so refusing it would reject a
   * link users routinely paste.
   */
  export const DocumentUrlPattern =
    /^https:\/\/docs\.google\.com\/(?:u\/\d+\/)?document\/d\/([A-Za-z0-9_-]{20,})(?:\/(?:edit|view|preview)?)?(?:[?#][A-Za-z0-9._~%!$&'()*+,;=:@/-]*)?$/

  /**
   * Matches a bare Drive file id. Google file ids are long; the length floor
   * keeps a short word ("root", "plan") from being taken for one.
   */
  export const BareDocumentIdPattern = /^[A-Za-z0-9_-]{20,}$/

  /** Matches the first absolute URL in a block of response text. */
  export const UrlPattern = /https?:\/\/\S+/

  /**
   * Matches a bare Drive id that is not a document id. A Shared Drive id is
   * shorter than a file id — around nineteen characters — so it needs its own,
   * lower floor; the floor still keeps a word such as `root` or a folder name
   * from being taken for an id.
   */
  export const BareDriveIdPattern = /^[A-Za-z0-9_-]{10,}$/

  /**
   * Builds the canonical edit URL of a Google Doc.
   *
   * This is the only URL the plugin ever shows for a Doc. Deriving it from the
   * recorded file id — rather than echoing a link a tool response or a command
   * line supplied — is what keeps a crafted tail out of the model's context.
   *
   * Rebuilding also drops everything a real Docs link may carry beside the id:
   * an account selector (`/u/1/`), a query such as `?usp=drivesdk`, a fragment,
   * and the `?tab=` segment a tabbed document is opened with. The link always
   * opens the document's first tab, which is where this plugin syncs the plan.
   *
   * @param documentId Google Doc file id.
   * @returns `https://docs.google.com/document/d/<id>/edit`.
   */
  export function newDocumentUrl(documentId: string): string {
    return `${DocumentUrlPrefix}${documentId}${DocumentUrlSuffix}`
  }
}

function readLabeledLine(text: string, label: string): string {
  if (text == null) {
    return null
  }
  const line = text
    .split("\n")
    .find(candidate => candidate.trim().startsWith(label))
  return line == null ? null : line.trim().slice(label.length).trim()
}

/**
 * Reads the Doc id and link out of an `import_to_google_doc` response.
 *
 * @param text raw tool response text
 * @returns the imported document, or `null` when the response carries no `Document ID:` line
 */
export function parseImportedDocument(text: string): ImportedDocument {
  const documentId = readLabeledLine(text, ToolResponseParsers.DocumentIdLabel),
    link = readLabeledLine(text, ToolResponseParsers.LinkLabel)
  return documentId == null ? null : { documentId, link }
}

/**
 * Reads the success flag and file id out of an `update_drive_file` response.
 *
 * @param text raw tool response text
 * @returns the update outcome; `success` is false whenever the success marker is absent
 */
export function parseUpdatedFile(text: string): UpdatedFile {
  const success =
      text != null && text.includes(ToolResponseParsers.SuccessMarker),
    fileId = readLabeledLine(text, ToolResponseParsers.FileIdLabel)
  return { success, fileId }
}

/**
 * Reads the comment id out of a `manage_document_comment` create response.
 *
 * @param text raw tool response text
 * @returns the created comment, or `null` when the response carries no `Comment ID:` line
 */
export function parseCreatedComment(text: string): CreatedComment {
  const commentId = readLabeledLine(text, ToolResponseParsers.CommentIdLabel)
  return commentId == null ? null : { commentId }
}

/**
 * Normalizes a Doc reference to its bare file id.
 *
 * Only the two canonical forms are accepted — a bare Drive file id, or a
 * `https://docs.google.com/document/d/<id>` URL — because this value decides
 * whether a write is aimed at the Doc under review.
 *
 * @param idOrUrl a bare Drive file id or a `https://docs.google.com/document/d/<id>/…` URL
 * @returns the file id, or `null` when the input is neither
 */
export function extractDocumentId(idOrUrl: string): string {
  if (idOrUrl == null) {
    return null
  }
  const candidate = idOrUrl.trim(),
    matched = ToolResponseParsers.DocumentUrlPattern.exec(candidate)
  if (matched != null) {
    return matched[1]
  }
  return ToolResponseParsers.BareDocumentIdPattern.test(candidate)
    ? candidate
    : null
}

/**
 * Reports whether a string is a canonical Google Docs document URL.
 *
 * @param candidate a link recorded in the review state
 * @returns true when the link matches {@link ToolResponseParsers.DocumentUrlPattern}
 */
export function isDocumentUrl(candidate: string): boolean {
  return (
    candidate != null &&
    ToolResponseParsers.DocumentUrlPattern.test(candidate.trim())
  )
}

/**
 * Reports whether a string is a bare Drive file id.
 *
 * @param candidate an id given on the command line or read from a response
 * @returns true when the id matches {@link ToolResponseParsers.BareDocumentIdPattern}
 */
export function isDocumentId(candidate: string): boolean {
  return (
    candidate != null &&
    ToolResponseParsers.BareDocumentIdPattern.test(candidate.trim())
  )
}

/**
 * Reports whether a string is shaped like a bare Drive id.
 *
 * It is the looser of the two id checks: a Shared Drive id is about nineteen
 * characters, well under the floor {@link isDocumentId} applies to a file id.
 * Nothing here says the id exists or that the caller may write to it — the
 * write gate compares against the registered Doc regardless.
 *
 * @param candidate an id given on the command line or read from a response
 * @returns true when the id matches {@link ToolResponseParsers.BareDriveIdPattern}
 */
export function isDriveId(candidate: string): boolean {
  return (
    candidate != null &&
    ToolResponseParsers.BareDriveIdPattern.test(candidate.trim())
  )
}

/**
 * Renders the link of a review's Doc for a message the model or the user will
 * read.
 *
 * The URL is built from the recorded file id, never taken from the recorded
 * link: the stored link reaches the state file from a tool response and from
 * the command line, so echoing it would make the plugin the carrier of
 * whatever address — or whatever prose hung off its tail — a reviewer put
 * there. An id that is not a Drive file id yields a notice instead.
 *
 * @param documentId the file id recorded on the review's Doc
 * @returns the canonical document URL, or {@link GDocReview.UntrustedDocUrlNotice}
 */
export function renderSafeDocumentUrl(documentId: string): string {
  return isDocumentId(documentId)
    ? ToolResponseParsers.newDocumentUrl(documentId.trim())
    : GDocReview.UntrustedDocUrlNotice
}

/**
 * Reads the shareable document link out of a tool response.
 *
 * @param text raw tool response text, from `get_drive_shareable_link` or `import_to_google_doc`
 * @returns the link, or `null` when the response carries no URL
 */
export function extractShareableLink(text: string): string {
  const labeled = readLabeledLine(text, ToolResponseParsers.LinkLabel)
  if (labeled != null && labeled !== "") {
    return labeled
  }
  if (text == null) {
    return null
  }
  const matched = ToolResponseParsers.UrlPattern.exec(text)
  return matched == null ? null : matched[0]
}
