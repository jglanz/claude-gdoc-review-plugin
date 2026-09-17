import { escapeRegExp } from "lodash"
import { match } from "ts-pattern"

import { GDocReview } from "../Constants.js"
import type { ApproveAutoMode } from "../config/index.js"
import {
  PluginConfig,
  resolveApproveAutoPermissionMode
} from "../config/index.js"
import { PermissionMode, ReviewDecisionChoice } from "../state/index.js"

/**
 * The four option labels of the custom approval menu, exactly as the user sees
 * them. The labels are the contract between the `AskUserQuestion` answer and
 * the recorded decision, so they are never reworded without a state migration.
 */
export enum ReviewMenuLabel {
  approveAuto = "Approve and Use Auto Mode",
  approveManual = "Approve Manual Mode",
  checkDoc = "Check Google Doc for new comments and changes",
  somethingElse = "Do something else"
}

function normalizeAnswer(answer: string): string {
  return answer == null ? "" : answer.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Constants, sub-types and builders of the custom approval menu. */
export namespace ReviewMenu {
  /** One selectable row of the menu. */
  export interface Option {
    /** Label shown to the user; one of the {@link ReviewMenuLabel} values. */
    label: string
    /** One-line explanation of what choosing the row does. */
    description: string
  }

  /** The counts and links the menu question states. */
  export interface Input {
    /** Link to the Google Doc under review. */
    docUrl: string
    /** Revision number that was just synced into the Doc. */
    revision: number
    /** Number of reviewer comments this revision addressed. */
    addressed: number
    /** Number of reviewer comments still open. */
    open: number

    /**
     * Configured mode for the first row; defaults to
     * {@link PluginConfig.DefaultApproveAutoMode}. It decides the row's
     * description, so the user reads the mode the approval actually requests.
     */
    approveAutoMode?: ApproveAutoMode
  }

  /** The complete `AskUserQuestion` question the model must present. */
  export interface Question {
    /** Menu header; the PostToolUse hook recognizes the menu by this value. */
    header: string
    /** Question body, including the Doc link and the round counters. */
    question: string
    /** Always false — the menu takes exactly one answer. */
    multiSelect: boolean
    /** The four options in presentation order. */
    options: Option[]
  }

  /** Header the menu is recognized by; shared with the decision-capture hook. */
  export const Header = GDocReview.MenuHeader

  /** First line of the question body. */
  export const Title = "Google Doc Plan Review"

  /** Trailing prompt of the question body. */
  export const Prompt = "How should we proceed?"

  /** The menu never takes more than one answer. */
  export const MultiSelect = false

  /** Description of the auto-approval option under `approveAutoMode: acceptEdits`. */
  export const ApproveAcceptEditsDescription =
    "Exit plan mode and auto-accept edits while implementing."

  /** Description of the auto-approval option under `approveAutoMode: auto`. */
  export const ApproveAutoModeDescription =
    "Exit plan mode and continue in auto mode."

  /**
   * Builds the description of the first row from the mode that row requests.
   *
   * The row switches the session into a permission mode without the built-in
   * dialog, so its description has to name the mode the configuration actually
   * asks for. Both sides derive it here — the renderer that hands the model the
   * menu, and the hook that recognises the menu it is answered with — so a
   * configured `auto` cannot make the presented row and the expected row differ.
   *
   * @param approveAutoMode Configured mode for option 1 of the menu.
   * @returns The row's description.
   */
  export function newApproveAutoDescription(
    approveAutoMode: ApproveAutoMode
  ): string {
    return match(resolveApproveAutoPermissionMode(approveAutoMode))
      .with(PermissionMode.auto, () => ApproveAutoModeDescription)
      .otherwise(() => ApproveAcceptEditsDescription)
  }

  /** Description of the manual-approval option. */
  export const ApproveManualDescription =
    "Exit plan mode and approve each edit manually."

  /** Description of the re-check option. */
  export const CheckDocDescription =
    "Re-read the Doc for new comments and reviewer edits, then ask again."

  /** Description of the free-text option. */
  export const SomethingElseDescription =
    "Stay in plan mode and follow an instruction you give instead."

  /** Opening fence of the rendered menu specification. */
  export const FenceOpen = "```json"

  /** Closing fence of the rendered menu specification. */
  export const FenceClose = "```"

  /**
   * Stands in for a counter while {@link questionPattern} builds its source.
   * It carries no RegExp metacharacter, so escaping the body leaves it intact
   * and it can be swapped for the digit group afterwards.
   */
  export const CounterPlaceholder = "<counter>"

  /** Pattern source matching one of the two counters the question states. */
  export const CounterPatternSource = "(\\d+)"

  /**
   * Builds the counters line closing the question body.
   *
   * The counters are taken as text rather than numbers so
   * {@link questionPattern} can build the same line with a placeholder where a
   * count goes, which is what keeps the pattern from drifting away from the
   * question.
   *
   * @param revision Revision the Doc holds.
   * @param addressed Comments this revision addressed, already rendered.
   * @param open Comments still open, already rendered.
   * @returns The last line of the question body.
   */
  export function newCountersLine(
    revision: number,
    addressed: string,
    open: string
  ): string {
    return `Revision ${revision} synced · ${addressed} addressed · ${open} open. ${Prompt}`
  }

  /**
   * Joins the three lines of the question body.
   *
   * @param docUrl Link to the Google Doc under review.
   * @param counters Counters line from {@link newCountersLine}.
   * @returns The question body the model must present verbatim.
   */
  export function newQuestionBody(docUrl: string, counters: string): string {
    return [Title, docUrl, counters].join("\n")
  }

  /**
   * Builds the pattern the body of a genuine review menu matches.
   *
   * Everything but the two counters is fixed: the title, the Doc link and the
   * revision are values the plugin itself knows, so the hook can hold the model
   * to the exact prose the protocol handed it and refuse a question whose body
   * was rewritten — a reworded prompt is the one part of the menu a user reads
   * before answering.
   *
   * @param docUrl Link the menu must quote; build it with `renderSafeDocumentUrl`.
   * @param revision Revision the Doc holds.
   * @returns A pattern anchored at both ends of the question body.
   */
  export function questionPattern(docUrl: string, revision: number): RegExp {
    const body = newQuestionBody(
        docUrl,
        newCountersLine(revision, CounterPlaceholder, CounterPlaceholder)
      ),
      source = escapeRegExp(body)
        .split(escapeRegExp(CounterPlaceholder))
        .join(CounterPatternSource)

    return new RegExp(`^${source}$`)
  }

  /**
   * Builds the exact question the model presents through `AskUserQuestion`.
   *
   * @param input Doc link and round counters
   * @returns the question, with the four labels in presentation order
   */
  export function createQuestion(input: ReviewMenu.Input): ReviewMenu.Question {
    const {
      docUrl,
      revision,
      addressed,
      open,
      approveAutoMode = PluginConfig.DefaultApproveAutoMode
    } = input
    return {
      header: Header,
      question: newQuestionBody(
        docUrl,
        newCountersLine(revision, String(addressed), String(open))
      ),
      multiSelect: MultiSelect,
      options: [
        {
          label: ReviewMenuLabel.approveAuto,
          description: newApproveAutoDescription(approveAutoMode)
        },
        {
          label: ReviewMenuLabel.approveManual,
          description: ApproveManualDescription
        },
        { label: ReviewMenuLabel.checkDoc, description: CheckDocDescription },
        {
          label: ReviewMenuLabel.somethingElse,
          description: SomethingElseDescription
        }
      ]
    }
  }

  /**
   * Maps an `AskUserQuestion` answer back to the recorded decision.
   *
   * Matching ignores case and surrounding or repeated whitespace; anything that
   * is not one of the four labels is free text the user typed into "Other".
   *
   * @param answer the answer string the tool response carried
   * @returns the matching choice, or `ReviewDecisionChoice.other` for free text
   */
  export function choiceForAnswer(answer: string): ReviewDecisionChoice {
    return match(normalizeAnswer(answer))
      .with(
        normalizeAnswer(ReviewMenuLabel.approveAuto),
        () => ReviewDecisionChoice.approve_auto
      )
      .with(
        normalizeAnswer(ReviewMenuLabel.approveManual),
        () => ReviewDecisionChoice.approve_manual
      )
      .with(
        normalizeAnswer(ReviewMenuLabel.checkDoc),
        () => ReviewDecisionChoice.check_doc
      )
      .otherwise(() => ReviewDecisionChoice.other)
  }

  /**
   * Renders a question as the fenced JSON block the round protocol embeds.
   *
   * @param question the question to render
   * @returns a fenced `json` block holding the question object
   */
  export function renderForModel(question: ReviewMenu.Question): string {
    return [FenceOpen, JSON.stringify(question, null, 2), FenceClose].join("\n")
  }
}
