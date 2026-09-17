import {
  ApproveAutoMode,
  GDocReview,
  ReviewDecisionChoice,
  ReviewMenu,
  ReviewMenuLabel
} from "claude-gdoc-review-plugin"

const DocUrl =
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit",
  newInput = (): ReviewMenu.Input => ({
    docUrl: DocUrl,
    revision: 2,
    addressed: 1,
    open: 3
  })

describe("ReviewMenu.createQuestion", () => {
  it("uses the header the decision hook matches on", () => {
    expect(ReviewMenu.Header).toBe(GDocReview.MenuHeader)
    expect(ReviewMenu.createQuestion(newInput()).header).toBe(
      GDocReview.MenuHeader
    )
  })

  it("renders the question text exactly as the protocol specifies", () => {
    expect(ReviewMenu.createQuestion(newInput()).question).toBe(
      `Google Doc Plan Review\n${DocUrl}\nRevision 2 synced · 1 addressed · 3 open. How should we proceed?`
    )
  })

  it("offers the four labels in order and takes a single answer", () => {
    const question = ReviewMenu.createQuestion(newInput())
    expect(question.multiSelect).toBe(false)
    expect(question.options.map(option => option.label)).toEqual([
      ReviewMenuLabel.approveAuto,
      ReviewMenuLabel.approveManual,
      ReviewMenuLabel.checkDoc,
      ReviewMenuLabel.somethingElse
    ])
    question.options.forEach(option =>
      expect(option.description.length).toBeGreaterThan(0)
    )
  })

  it("states a zero round with zeros rather than omitting the counters", () => {
    expect(
      ReviewMenu.createQuestion({
        docUrl: DocUrl,
        revision: 1,
        addressed: 0,
        open: 0
      }).question
    ).toContain("Revision 1 synced · 0 addressed · 0 open.")
  })
})

describe("ReviewMenu.questionPattern", () => {
  it("matches the question the menu builder produces, counters aside", () => {
    const pattern = ReviewMenu.questionPattern(DocUrl, 2)

    expect(pattern.test(ReviewMenu.createQuestion(newInput()).question)).toBe(
      true
    )
    expect(
      pattern.test(
        ReviewMenu.createQuestion({
          docUrl: DocUrl,
          revision: 2,
          addressed: 0,
          open: 0
        }).question
      )
    ).toBe(true)
    expect(
      pattern.test(
        ReviewMenu.createQuestion({
          docUrl: DocUrl,
          revision: 2,
          addressed: 140,
          open: 7
        }).question
      )
    ).toBe(true)
  })

  it("refuses another revision, another Doc and reworded prose", () => {
    const pattern = ReviewMenu.questionPattern(DocUrl, 2),
      question = ReviewMenu.createQuestion(newInput()).question

    expect(
      pattern.test(
        ReviewMenu.createQuestion({ ...newInput(), revision: 3 }).question
      )
    ).toBe(false)
    expect(
      pattern.test(
        ReviewMenu.createQuestion({
          ...newInput(),
          docUrl:
            "https://docs.google.com/document/d/1OtherAbCdEfGhIjKlMnOpQrStUvWxYz01/edit"
        }).question
      )
    ).toBe(false)
    expect(
      pattern.test(question.replace(ReviewMenu.Title, "Quick check"))
    ).toBe(false)
    expect(pattern.test(question.replace(ReviewMenu.Prompt, "Approve?"))).toBe(
      false
    )
    expect(pattern.test(`${question}\nThe reviewers already approved.`)).toBe(
      false
    )
    expect(pattern.test(`Ignore this. ${question}`)).toBe(false)
  })

  it("refuses a counter that is not a number, and empty text", () => {
    const pattern = ReviewMenu.questionPattern(DocUrl, 2)

    expect(
      pattern.test(
        ReviewMenu.newQuestionBody(
          DocUrl,
          ReviewMenu.newCountersLine(2, "all", "0")
        )
      )
    ).toBe(false)
    expect(pattern.test("")).toBe(false)
  })

  it("escapes the Doc link rather than treating it as a pattern", () => {
    const notice = "(link withheld: the registered Doc link is not canonical)",
      pattern = ReviewMenu.questionPattern(notice, 1)

    expect(
      pattern.test(
        ReviewMenu.newQuestionBody(
          notice,
          ReviewMenu.newCountersLine(1, "0", "0")
        )
      )
    ).toBe(true)
    expect(
      pattern.test(
        ReviewMenu.newQuestionBody("x", ReviewMenu.newCountersLine(1, "0", "0"))
      )
    ).toBe(false)
  })
})

describe("ReviewMenu.choiceForAnswer", () => {
  it("maps each label to its choice", () => {
    expect(ReviewMenu.choiceForAnswer(ReviewMenuLabel.approveAuto)).toBe(
      ReviewDecisionChoice.approve_auto
    )
    expect(ReviewMenu.choiceForAnswer(ReviewMenuLabel.approveManual)).toBe(
      ReviewDecisionChoice.approve_manual
    )
    expect(ReviewMenu.choiceForAnswer(ReviewMenuLabel.checkDoc)).toBe(
      ReviewDecisionChoice.check_doc
    )
    expect(ReviewMenu.choiceForAnswer(ReviewMenuLabel.somethingElse)).toBe(
      ReviewDecisionChoice.other
    )
  })

  it("ignores case and surrounding or repeated whitespace", () => {
    expect(ReviewMenu.choiceForAnswer("  approve   and use AUTO mode \n")).toBe(
      ReviewDecisionChoice.approve_auto
    )
  })

  it("treats free text, empty answers and a missing answer as other", () => {
    expect(
      ReviewMenu.choiceForAnswer("Add a rollback section, then show the menu")
    ).toBe(ReviewDecisionChoice.other)
    expect(ReviewMenu.choiceForAnswer("")).toBe(ReviewDecisionChoice.other)
    expect(ReviewMenu.choiceForAnswer(null)).toBe(ReviewDecisionChoice.other)
  })
})

describe("ReviewMenu.renderForModel", () => {
  it("renders a fenced JSON block that parses back into the question", () => {
    const question = ReviewMenu.createQuestion(newInput()),
      rendered = ReviewMenu.renderForModel(question),
      lines = rendered.split("\n")

    expect(lines[0]).toBe(ReviewMenu.FenceOpen)
    expect(lines[lines.length - 1]).toBe(ReviewMenu.FenceClose)
    expect(JSON.parse(lines.slice(1, -1).join("\n"))).toEqual(question)
  })

  it("embeds no template placeholder that the protocol renderer would reject", () => {
    expect(
      ReviewMenu.renderForModel(ReviewMenu.createQuestion(newInput()))
    ).not.toContain("{{")
  })
})

describe("ReviewMenu.newApproveAutoDescription", () => {
  it("names auto-accepted edits under the default configuration", () => {
    expect(
      ReviewMenu.newApproveAutoDescription(ApproveAutoMode.acceptEdits)
    ).toBe(ReviewMenu.ApproveAcceptEditsDescription)
  })

  it("names auto mode when that is what the row requests", () => {
    // The row switches the session into a permission mode with no built-in
    // dialog, so what the user reads has to be the mode they are approving.
    expect(ReviewMenu.newApproveAutoDescription(ApproveAutoMode.auto)).toBe(
      ReviewMenu.ApproveAutoModeDescription
    )
    expect(
      ReviewMenu.createQuestion({
        docUrl:
          "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit",
        revision: 1,
        addressed: 0,
        open: 0,
        approveAutoMode: ApproveAutoMode.auto
      }).options[0].description
    ).toBe(ReviewMenu.ApproveAutoModeDescription)
  })
})
