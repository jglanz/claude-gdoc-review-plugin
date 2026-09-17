import {
  ApprovalMode,
  ApproveAutoMode,
  PermissionMode,
  PermissionUpdateDestination,
  PermissionUpdateType,
  resolveApprovalMode,
  ReviewDecisionChoice
} from "claude-gdoc-review-plugin"

const AutoSuggestion = {
    type: PermissionUpdateType.setMode,
    mode: PermissionMode.auto,
    destination: PermissionUpdateDestination.session
  },
  AcceptEditsSuggestion = {
    type: PermissionUpdateType.setMode,
    mode: PermissionMode.acceptEdits,
    destination: PermissionUpdateDestination.session
  }

describe("resolveApprovalMode", () => {
  it("maps the manual approval onto the engine's default mode", () => {
    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.approve_manual,
        approveAutoMode: ApproveAutoMode.auto,
        permissionSuggestions: [AutoSuggestion]
      })
    ).toBe(PermissionMode.default)
  })

  it("maps the auto approval onto the configured mode", () => {
    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.approve_auto,
        approveAutoMode: ApproveAutoMode.acceptEdits
      })
    ).toBe(PermissionMode.acceptEdits)
  })

  it("requests auto mode only when the prompt offers it", () => {
    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.approve_auto,
        approveAutoMode: ApproveAutoMode.auto,
        permissionSuggestions: [AcceptEditsSuggestion, AutoSuggestion]
      })
    ).toBe(PermissionMode.auto)
  })

  it("falls back when auto is configured but not offered", () => {
    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.approve_auto,
        approveAutoMode: ApproveAutoMode.auto,
        permissionSuggestions: [AcceptEditsSuggestion]
      })
    ).toBe(ApprovalMode.Fallback)

    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.approve_auto,
        approveAutoMode: ApproveAutoMode.auto
      })
    ).toBe(ApprovalMode.Fallback)
  })

  it("has no mode for a choice that is not an approval", () => {
    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.check_doc,
        approveAutoMode: ApproveAutoMode.acceptEdits
      })
    ).toBeNull()

    expect(
      resolveApprovalMode({
        choice: ReviewDecisionChoice.other,
        approveAutoMode: ApproveAutoMode.acceptEdits
      })
    ).toBeNull()
  })
})
