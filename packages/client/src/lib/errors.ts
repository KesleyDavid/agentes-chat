import type { TFunction } from "i18next";
import { ApiError, NetworkError } from "../api/http";
import type { AuthConfig, OrgStanding } from "../api/types";
import { billingHoldOf } from "./billing";
import { MAX_UPLOAD_MB } from "./files";
import { joinNames, lowerFirst } from "./format";
import { agentGrammar } from "./grammar";
import { limitRefusalText } from "./limits";
import { providerOf } from "./providers";
import { endSentence } from "./text";

/** No sign-in in the last 10 minutes, which adding a password takes. */
export const REAUTH_SIGN_IN = "reauth.sign_in";
/** No password, or a wrong one, where it proves it's the person (deleting on a server that sends no email). */
export const REAUTH_PASSWORD = "reauth.password";

/**
 * Server error codes the app says in the person's language (the server's own message is English). Anything else
 * takes `untranslatedText`; a guard test (`error-words.test.ts`) fails on a new code that isn't here or on its list.
 */
const KNOWN = {
  // A new-password link an owner can't make (ADR 0158).
  "password_link.email": "errors.passwordLink.email",
  "password_link.server_owner": "errors.passwordLink.serverOwner",
  "password_link.other_workspace": "errors.passwordLink.otherWorkspace",
  "webhook.github_no_access": "errors.webhook.githubNoAccess",
  "webhook.github_failed": "errors.webhook.githubFailed",
  "webhook.invalid_secret": "errors.webhook.invalidSecret",
  "webhook.invalid_repo": "errors.webhook.invalidRepo",
  "github_event.answered": "errors.githubEvent.answered",
  "github_event.not_found": "errors.said.gone",
  "github_event.agent_not_here": "errors.routine.agentNotInChannel",
  "channel.post_denied": "channel.perms.readOnlyComposer",
  "channel.permission_forbidden": "channel.perms.forbidden",
  "agent.handle_taken": "newAgent.errors.handleTaken",
  "agent.right_hand_permanent": "errors.rightHand.permanent",
  "agent.not_owner": "errors.agent.ownerOrAdmin",
  "usage_queue.cancel_forbidden": "errors.agent.ownerOrAdmin",
  "agent.details_hidden": "errors.agent.detailsHidden",
  "brain.extra_owner_only": "errors.agent.extraOwnerOnly",
  "action.not_allowed": "errors.agent.undoForbidden",
  "account.not_owner": "errors.account.notOwner",
  "channel.members_forbidden": "errors.channel.membersForbidden",
  "agent_proposal.not_requester": "errors.agentProposal.notRequester",
  "proposal.not_requester": "errors.agentProposal.notRequester",
  "agent_proposal.decided": "errors.agentProposal.decided",
  "approval.always_unavailable": "errors.approval.alwaysUnavailable",
  "agent_proposal.expired": "errors.agentProposal.expired",
  "team_proposal.decided": "errors.agentProposal.decided",
  "team_proposal.expired": "errors.agentProposal.expired",
  "team_proposal.undo_expired": "errors.teamProposal.undoExpired",
  "agent_proposal.routine_made": "errors.agentProposal.routineMade",
  "agent_proposal.no_routine": "errors.agentProposal.noRoutine",
  "mail.account_not_found": "errors.mail.accountNotFound",
  "mail.from_not_mailbox": "errors.mail.fromNotMailbox",
  "mail.owner_only": "errors.mail.ownerOnly",
  send_without_recipients: "mail.agent.saveError.send_without_recipients",
  "artifact.file_too_large": "errors.artifact.fileTooLarge",
  "artifact.not_versioned": "errors.artifact.notVersioned",
  "artifact.file_required": "errors.artifact.fileRequired",
  "artifact.file_name_required": "errors.artifact.fileNameRequired",
  "artifact.not_found": "errors.artifact.notFound",
  "artifact.delete_forbidden": "errors.artifact.deleteForbidden",
  "artifact.restore_forbidden": "errors.artifact.restoreForbidden",
  "artifact.version_not_found": "errors.artifact.versionNotFound",
  "artifact.format_unavailable": "errors.artifact.formatUnavailable",
  "artifact.sharing_open": "errors.artifact.sharingOpen",
  "artifact.sharing_forbidden": "errors.artifact.sharingForbidden",
  "artifact.sharing_empty": "errors.artifact.sharingEmpty",
  "artifact.sharing_too_many": "errors.artifact.sharingTooMany",
  "artifact.not_in_drive": "errors.artifact.notInDrive",
  "machine.forbidden": "errors.machine.forbidden",
  "device.forbidden": "errors.machine.forbidden",
  "device.link_not_found": "errors.machine.pairingInvalid",
  "device.not_link_maker": "errors.device.notLinkMaker",
  "device.widen_forbidden": "errors.device.widenForbidden",
  "device.not_home": "errors.device.notHome",
  "machine.not_found": "errors.machine.notFound",
  "machine.name_required": "errors.machine.nameRequired",
  "account.method_unsupported": "errors.machine.accountMethodUnsupported",
  "machine.pairing_invalid": "errors.machine.pairingInvalid",
  "machine.pairing_off": "errors.machine.pairingOff",
  "machine.target_offline": "errors.machine.targetOffline",
  "machine.target_not_found": "errors.machine.targetNotFound",
  "machine.target_same": "errors.machine.targetSame",
  "machine.target_paused": "errors.machine.targetPaused",
  // A computer that can't take the request now (`MachineOfflineError`, `MachinePausedError`: `name`), or its own
  // refusal (`MachineRequestError`, as `machine.<code>`).
  "machine.offline": "errors.machine.offline",
  "machine.paused": "errors.machine.paused",
  "machine.timeout": "errors.machine.timeout",
  "machine.exec_disabled": "errors.mission.execDisabled",
  budget_exceeded: "agentPage.activity.errors.budget_exceeded",
  "agent_group.not_found": "errors.agentGroup.notFound",
  "agent_group.too_many": "errors.agentGroup.tooMany",
  "thread.context_not_visible": "errors.thread.contextNotVisible",
  "thread.archived": "errors.thread.archived",
  "thread.has_replies": "errors.thread.hasReplies",
  "thread.range_has_replies": "errors.thread.rangeHasReplies",
  "thread.move_other_channel": "errors.thread.moveOtherChannel",
  "thread.not_allowed": "errors.thread.notAllowed",
  "thread.range_invalid": "errors.thread.rangeInvalid",
  "thread.range_empty": "errors.thread.rangeEmpty",
  "thread.range_too_long": "errors.thread.rangeTooLong",
  "thread.title_too_long": "errors.thread.titleTooLong",
  "thread.no_context": "errors.thread.noContext",
  "thread.not_undoable": "errors.thread.notUndoable",
  "mission.not_found": "errors.mission.notFound",
  "mission.not_owner": "errors.mission.notOwner",
  "mission.not_allowed": "errors.mission.notAllowed",
  "mission.not_participant": "errors.mission.notParticipant",
  "mission.agent_unavailable": "errors.mission.agentUnavailable",
  "mission.no_computer": "errors.mission.noComputer",
  "mission.computer_offline": "errors.mission.computerOffline",
  "mission.exec_disabled": "errors.mission.execDisabled",
  "mission.runner_outdated": "errors.mission.runnerOutdated",
  "mission.exists": "errors.mission.exists",
  "mission.closed": "errors.mission.closed",
  "mission.wrong_status": "errors.mission.wrongStatus",
  "mission.paused": "errors.mission.paused",
  // Apps can't connect to a workspace on hold (`apps/grants.ts`, `apps/oauth.ts`).
  workspace_paused: "errors.org.paused",
  "mission.invalid": "errors.mission.invalid",
  "mission.bad_folder": "errors.mission.badFolder",
  "mission.bad_option": "errors.mission.badOption",
  "mission.decision_taken": "errors.mission.decisionTaken",
  "mission.decision_not_found": "errors.mission.decisionNotFound",
  "mission.review_not_found": "errors.mission.reviewNotFound",
  "mission.review_note_required": "errors.mission.reviewNoteRequired",
  "mission.suggestion_not_found": "errors.mission.suggestionNotFound",
  "mission.is_owner": "errors.mission.isOwner",
  "mission.participant_cannot_see": "errors.mission.cannotSee",
  "mission.not_your_computer": "errors.mission.notYourComputer",
  "mission.needs_computer": "errors.mission.needsComputer",
  "mission.unavailable": "errors.mission.unavailable",
  "mission.machine_changed": "errors.mission.machineChanged",
  "run.not_continuable": "errors.run.notContinuable",
  "run.agent_busy": "errors.run.agentBusy",
  "run.continue_forbidden": "errors.run.continueForbidden",
  "run.cancel_forbidden": "errors.run.cancelForbidden",
  "run.answer_forbidden": "errors.run.answerForbidden",
  "run.stop_reason_forbidden": "errors.run.stopReasonForbidden",
  "run.not_restartable": "errors.run.notRestartable",
  "run.not_restartable_voice": "errors.run.notRestartableVoice",
  "routine.too_frequent": "errors.routine.tooFrequent",
  "routine.too_many": "errors.routine.tooMany",
  "routine.creator_cannot_post": "errors.routine.creatorCannotPost",
  "routine.take_over_no_access": "errors.routine.takeOverNoAccess",
  "routine.act_take_over": "errors.routine.actTakeOver",
  "routine.actions_need_approver": "errors.routine.actionsNeedApprover",
  "routine.editor_only": "errors.routine.editorOnly",
  "routine.widget_fixed": "errors.routine.widgetFixed",
  "routine.agent_not_in_channel": "errors.routine.agentNotInChannel",
  "routine.webhook_paused": "errors.routine.webhookPaused",
  "routine.continue_extra_off": "errors.routine.continueExtraOff",
  "run.continue_extra_off": "errors.routine.continueExtraOff",
  "routine.continue_extra_used_up": "errors.routine.continueExtraUsedUp",
  "run.continue_extra_used_up": "errors.routine.continueExtraUsedUp",
  "wiki.no_access": "errors.wiki.noAccess",
  "wiki.audience_forbidden": "errors.wiki.audienceForbidden",
  "wiki.audience_excludes_you": "errors.wiki.audienceExcludesYou",
  "wiki.audience_wider_than_folder": "errors.wiki.audienceWiderThanFolder",
  "wiki.edit_limited": "errors.wiki.editLimited",
  "wiki.locked": "wiki.lockedHint",
  "wiki.lock_admins_only": "errors.wiki.lockAdminsOnly",
  "wiki.editors_exclude_you": "errors.wiki.editorsExcludeYou",
  "wiki.context_full": "errors.wiki.contextFull",
  "wiki.restore_slug_taken": "errors.wiki.restoreSlugTaken",
  "role.name_required": "errors.role.nameRequired",
  "role.name_long": "errors.role.nameLong",
  "role.too_many": "errors.role.tooMany",
  "role.grant_forbidden": "errors.role.grantForbidden",
  "role.above_you": "errors.role.aboveYou",
  "role.base": "errors.role.base",
  "role.unknown": "errors.role.unknown",
  "role.order_incomplete": "errors.role.orderIncomplete",
  "connector.label_taken": "errors.connector.labelTaken",
  "connector.label_invalid": "errors.connector.labelInvalid",
  "connector.other_account": "errors.connector.otherAccount",
  "connector.account_unknown": "errors.connector.accountUnknown",
  "connector.other_server": "errors.connector.otherServer",
  "connector.gone": "errors.connector.gone",
  "connector.unfinished": "errors.connector.unfinished",
  "connector.unavailable": "errors.connector.unavailable",
  "connector.misconfigured": "errors.connector.misconfigured",
  // Facts only (the phone shows this one): the web's onboarding says `standing.createUnpaid` beside the way to pay.
  "org.create_unpaid": "standing.createInactive",
  "credentials.plan_hold": "connectAi.key.closed",
  "machine.managed": "computerSetup.managedNotRemovable",
  "machine.managed_access": "computerSetup.managedAccess",
  "join.link_closed": "errors.join.linkClosed",
  "join.full": "errors.join.full",
  "join.rate_limited": "errors.join.rateLimited",
  "join.link_busy": "errors.join.linkBusy",
  "join.member": "errors.join.member",
  "join.denied": "errors.join.denied",
  "join.answered": "errors.join.answered",
  "join.expired": "errors.join.expired",
  "join.code_wrong": "errors.code.wrong",
  "join.code_expired": "errors.code.expired",
  "join.code_tries": "errors.code.tries",
  "join.code_limit": "errors.code.limit",
  "join.code_wait": "errors.code.wait",
  "join.code_needed": "errors.join.codeNeeded",
  "reauth.code": "errors.reauth.code",
  "reauth.code_wrong": "errors.code.wrong",
  "reauth.code_expired": "errors.code.expired",
  "reauth.code_tries": "errors.code.tries",
  "reauth.code_limit": "errors.code.limit",
  "reauth.code_wait": "errors.code.wait",
  "invitation.ask_to_join": "errors.invitation.askToJoin",
  "org.create_invite_only": "errors.org.createInviteOnly",
  "org.not_restorable": "errors.org.notRestorable",
  "account.not_restorable": "errors.account.notRestorable",
  "issue.assignee_outside": "errors.issue.assigneeOutside",
  "issue_column.stage_full": "errors.issue.stageFull",
  "issue.delete_forbidden": "errors.issue.deleteForbidden",
  "issue.audience_empty": "errors.issue.audienceEmpty",
  [REAUTH_PASSWORD]: "errors.reauth.password",
  [REAUTH_SIGN_IN]: "errors.reauth.signIn",
  EARLY_ACCESS_OTHER_EMAIL: "auth.earlyAccess.otherEmail",
  EARLY_ACCESS_EMAIL_UNVERIFIED: "auth.earlyAccess.unverified",
  // A provider's sign-up on a closed server comes back to /login with this code.
  SIGNUP_CLOSED: "auth.flow.closedLead",
  // A sign-up whose name is its password (apps/server auth.ts `NAME_IS_PASSWORD`).
  NAME_IS_PASSWORD: "auth.flow.nameIsPassword",
  // Better Auth's own refusals on sign-up or a password change (an expired reset link is the reset page's own state).
  USER_ALREADY_EXISTS: "auth.refused.linked",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "auth.refused.linked",
  INVALID_EMAIL: "errors.said.validEmail",
  PASSWORD_TOO_SHORT: "auth.passwordHelp",
  PASSWORD_TOO_LONG: "auth.passwordTooLong",
  INVALID_PASSWORD: "errors.reauth.password",
  account_not_linked: "auth.unconfirmed",
  // A provider that hasn't confirmed its own address, to a confirmed account here (apps/server auth.ts `authHandler`).
  provider_email_unverified: "auth.providerUnverified",
  human_check: "errors.humanCheck",
  human_check_blocked: "errors.humanCheckBlocked",
  // TypeSafe refused the key pasted for Jev: said under its field, nothing kept.
  jev_key_invalid: "jev.steps.invalid",
  // GIPHY refused the key pasted for GIFs (ADR 0091): said under its field, nothing kept.
  gif_key_invalid: "settings.media.giphy.invalid",
  // A key's test call on save: nothing kept (`keyRefusal` adds the provider's words and where to fix it).
  provider_key_invalid: "settings.keyRefused",
  provider_key_no_credit: "settings.keyNoCredit",
  provider_key_denied: "settings.keyDenied",
  provider_key_management: "settings.keyManagement",
  "credential.in_use": "settings.keyInUse",
  "credential.default": "settings.removeDefaultBlocked",
  "github.repo_missing": "errors.github.repoMissing",
  "github.ref_missing": "errors.github.refMissing",
  // `count`: minutes until GitHub stops limiting the server.
  "github.limited": "errors.github.limited",
  "github.unreachable": "errors.github.unreachable",
  "skill.no_skill_md": "errors.skill.noSkillMd",
  "skill.too_many_skills": "errors.skill.tooManySkills",
  "skill.invalid_name": "errors.skill.invalidName",
  "skill.invalid_description": "errors.skill.invalidDescription",
  "skill.too_large": "errors.skill.tooLarge",
  "skill.too_many_files": "errors.skill.tooManyFiles",
  "skill.repo_too_large": "errors.skill.repoTooLarge",
  "skill.no_frontmatter": "errors.skill.noFrontmatter",
  "skill.body_too_long": "errors.skill.bodyTooLong",
  "skill.no_skill_md_zip": "errors.skill.noSkillMdZip",
  "skill.not_github_link": "errors.skill.notGithubLink",
  "skill.bad_zip": "errors.skill.badZip",
  "skill.connection_gone": "errors.skill.connectionGone",
  "skill.link_holds_several": "errors.skill.linkHoldsSeveral",
  "skill.link_renamed": "errors.skill.linkRenamed",
  "skill.no_link": "errors.skill.noLink",
  "skill.no_pending_update": "errors.skill.noPendingUpdate",
  "handle.invalid": "errors.handle.invalid",
  "handle.taken": "errors.handle.taken",
  "handle.taken_by_agent": "errors.handle.takenByAgent",
  slug_taken: "errors.wiki.titleTaken",
  "wiki.title_characters": "errors.wiki.titleCharacters",
  "wiki.title_empty_slug": "errors.wiki.titleNoLetters",
  // GIFs and stickers (ADR 0091): off in the workspace (or no GIF search on this server), a GIF gone, or the GIF
  // search not answering.
  "message.reply_not_found": "errors.replyGone",
  "message.media_off": "errors.media.off",
  "message.media_not_found": "errors.media.notFound",
  "gifs.off": "errors.media.gifsOff",
  "gifs.unavailable": "errors.media.gifsUnavailable",
  // Boards and widgets (ADR 0135).
  "dashboard.not_found": "dashboards.errors.notFound",
  "dashboard.forbidden": "dashboards.errors.forbidden",
  "dashboard.home_fixed": "dashboards.errors.homeFixed",
  "dashboard.roles_required": "dashboards.errors.rolesRequired",
  "dashboard.role_unknown": "dashboards.errors.roleUnknown",
  "dashboard.title_required": "dashboards.errors.titleRequired",
  "dashboard.too_many": "dashboards.errors.tooMany",
  "dashboard.publish_forbidden": "dashboards.errors.publishForbidden",
  "dashboard.proposal_none": "dashboards.errors.proposalNone",
  "dashboard.proposal_not_yours": "dashboards.errors.proposalNotYours",
  "widget.not_found": "dashboards.errors.widgetNotFound",
  "widget.too_many": "dashboards.errors.widgetTooMany",
  "widget.scheduled_cap": "dashboards.errors.scheduledCap",
  "widget.agent_unreachable": "dashboards.errors.agentUnreachable",
  "widget.agent_archived": "dashboards.errors.agentArchived",
  "widget.block_not_found": "dashboards.errors.blockNotFound",
  "widget.not_agent_message": "dashboards.errors.notAgentMessage",
  "widget.prompt_required": "dashboards.errors.promptRequired",
  "widget.not_tested": "dashboards.errors.notTested",
  // The Vault (ADR 0144): what a person typed, who may see or use an item, an import, a card's "Save to the Vault".
  "vault.invalid": "errors.vault.invalid",
  "vault.not_found": "errors.vault.notFound",
  "vault.title_required": "errors.vault.titleRequired",
  // `max`: the limit the field passed (characters, or bytes for a value).
  "vault.too_long": "errors.vault.tooLong",
  "vault.not_https": "errors.vault.notHttps",
  "vault.key_name_invalid": "errors.vault.keyNameInvalid",
  "vault.key_name_reserved": "errors.vault.keyNameReserved",
  "vault.key_name_taken": "errors.vault.keyNameTaken",
  "vault.contact_empty": "errors.vault.contactEmpty",
  "vault.team_needs_permission": "errors.vault.teamNeedsPermission",
  "vault.external_read_only": "errors.vault.externalReadOnly",
  "vault.changed_meanwhile": "errors.vault.changedMeanwhile",
  "vault.no_value": "errors.vault.noValue",
  "vault.missing": "errors.vault.missing",
  "vault.not_allowed": "errors.vault.notAllowed",
  "vault.too_many_items": "errors.vault.tooManyItems",
  "vault.audience_invalid": "errors.vault.audienceInvalid",
  "vault.agents_invalid": "errors.vault.agentsInvalid",
  "vault.too_many_agents": "errors.vault.tooManyAgents",
  "vault.too_many_roles": "errors.vault.tooManyRoles",
  "vault.too_many_people": "errors.vault.tooManyPeople",
  "vault.unknown_agent": "errors.vault.agentsInvalid",
  "vault.unknown_role": "errors.vault.audienceInvalid",
  "vault.csv_too_large": "errors.vault.csvTooLarge",
  "vault.csv_too_many_rows": "errors.vault.csvTooManyRows",
  "vault.csv_unrecognized": "errors.vault.csvUnrecognized",
  "vault.request_not_delivered": "errors.vault.requestNotDelivered",
  "vault.request_not_savable": "errors.vault.requestNotSavable",
  "vault.source_unknown": "errors.vault.sourceUnknown",
  "vault.source_error": "errors.vault.sourceError",
  // A password manager's refusal (`VaultSourceError`), as `vault.source.<code>`.
  "vault.source.auth_failed": "errors.vault.source.authFailed",
  "vault.source.locked": "errors.vault.source.locked",
  "vault.source.many_vaults": "errors.vault.source.manyVaults",
  "vault.source.no_vault": "errors.vault.source.noVault",
  "vault.source.folder_missing": "errors.vault.source.folderMissing",
  "vault.source.not_found": "errors.vault.source.notFound",
  "vault.source.rate_limited": "errors.vault.source.rateLimited",
  "vault.source.unreachable": "errors.vault.source.unreachable",
  "vault.source.unsupported": "errors.vault.source.unsupported",
  "vault.source.invalid_input": "errors.vault.source.invalidInput",
  "account.login_not_found": "errors.said.gone",
  "device.not_found": "errors.said.gone",
  "account.not_found": "errors.said.gone",
  "account.invalid": "errors.said.gone",
  "action.not_found": "errors.said.gone",
  "action.target_gone": "errors.said.gone",
  "action_card.not_found": "errors.said.gone",
  "agent_proposal.not_found": "errors.said.gone",
  "approval_cover.not_found": "errors.said.gone",
  "database.not_found": "errors.said.gone",
  "follow_up.not_found": "errors.said.gone",
  "message.not_found": "errors.said.gone",
  "mission.command_not_found": "errors.said.gone",
  "mission.delivery_item_not_found": "errors.said.gone",
  "mission.delivery_not_found": "errors.said.gone",
  "mission.join_not_found": "errors.said.gone",
  "mission.rule_not_found": "errors.said.gone",
  "pull.not_found": "errors.said.gone",
  "right_hand.not_found": "errors.said.gone",
  "routine.no_webhook": "errors.said.gone",
  "task.not_found": "errors.said.gone",
  "team_proposal.no_agent": "errors.said.gone",
  "team_proposal.not_found": "errors.said.gone",
  "upload.not_found": "errors.said.gone",
  "wiki.page_not_found": "errors.said.gone",
  "wiki.version_not_found": "errors.said.gone",
  "action.already_undone": "errors.said.alreadyDone",
  "device.request_not_found": "errors.said.alreadyDone",
  "action.not_undone": "errors.said.alreadyDone",
  "action_card.asked": "errors.said.alreadyDone",
  "action_card.decided": "errors.said.alreadyDone",
  "agent_proposal.asked": "errors.said.alreadyDone",
  "approval.not_ahead": "errors.said.alreadyDone",
  "approval.not_cancelable": "errors.said.alreadyDone",
  "browser.handoff_over": "errors.said.alreadyDone",
  "choices.answered": "errors.said.alreadyDone",
  "follow_up.not_pending": "errors.said.alreadyDone",
  "join.verified": "errors.said.alreadyDone",
  "message.already_sent": "errors.said.alreadyDone",
  "mission.already_participant": "errors.said.alreadyDone",
  "mission.delivery_decided": "errors.said.alreadyDone",
  "mission.join_decided": "errors.said.alreadyDone",
  "mission.review_decided": "errors.said.alreadyDone",
  "poll.closed": "errors.said.alreadyDone",
  "proposal.asked": "errors.said.alreadyDone",
  "proposal.decided": "errors.said.alreadyDone",
  "right_hand.undone": "errors.said.alreadyDone",
  run_finished: "errors.said.alreadyDone",
  "secret.closed": "errors.said.alreadyDone",
  "team_week.done": "errors.said.alreadyDone",
  "upload.not_pending": "errors.said.alreadyDone",
  "agent.mail_loss_changed": "errors.said.changed",
  "mission.plan_conflict": "errors.said.changed",
  "run.state_changed": "errors.said.changed",
  "action.changed_since": "errors.said.tooLateUndo",
  "action.expired": "errors.said.tooLateUndo",
  "action.not_undoable": "errors.said.tooLateUndo",
  "right_hand.changed_since": "errors.said.tooLateUndo",
  "right_hand.undo_expired": "errors.said.tooLateUndo",
  "approval_cover.ends_past": "errors.said.futureTime",
  "notifications.snooze_in_past": "errors.said.futureTime",
  "schedule.in_the_past": "errors.said.futureTime",
  "when.past": "errors.said.futureTime",
  "notifications.snooze_too_far": "errors.said.tooFar",
  "when.too_far": "errors.said.tooFar",
  "calendar.invalid_date": "errors.said.checkDate",
  "calendar.not_invited": "errors.said.notInvited",
  "notifications.bad_snooze": "errors.said.checkDate",
  "schedule.invalid_datetime": "errors.said.checkDate",
  "schedule.invalid_time": "errors.said.checkDate",
  "schedule.invalid_start": "errors.said.checkDate",
  "schedule.invalid_until": "errors.said.checkDate",
  "schedule.until_before_start": "errors.said.checkDate",
  "agent_group.not_member": "errors.said.notInWorkspace",
  "approval_cover.not_member": "errors.said.notInWorkspace",
  "account.invalid_email": "errors.said.validEmail",
  invalid_email: "errors.said.validEmail",
  "join.invalid_email": "errors.said.validEmail",
  "mail.invalid_address": "errors.said.validEmail",
  "mail.invalid_alias": "errors.said.validEmail",
  "mail.invalid_from": "errors.said.validEmail",
  "mail.invalid_rule": "errors.said.validEmail",
  "database.too_many": "errors.said.tooMany",
  "endpoint.too_many_models": "errors.said.tooMany",
  "mail.too_many_addresses": "errors.said.tooMany",
  "mail.too_many_aliases": "errors.said.tooMany",
  "mail.too_many_folders": "errors.said.tooMany",
  "message.too_many_attachments": "errors.said.tooMany",
  "pins.limit": "errors.said.tooMany",
  "routine.too_many_actions": "errors.said.tooMany",
  token_limit: "errors.said.tooMany",
  "voice.limit": "errors.said.tooMany",
  "wiki.folder_depth": "errors.said.tooMany",
  "wiki.import_too_many": "errors.said.tooMany",
  "database.host_required": "errors.said.fillIn",
  "device.name_required": "errors.said.fillIn",
  "database.password_required": "errors.said.fillIn",
  "database.user_required": "errors.said.fillIn",
  "endpoint.no_models": "errors.said.fillIn",
  "mail.hosts_required": "errors.said.fillIn",
  "mail.password_required": "errors.said.fillIn",
  "mission.delivery_note_required": "errors.said.fillIn",
  "reminder.text_required": "errors.said.fillIn",
  "routine.connector_inbox_invalid": "errors.said.fillIn",
  "routine.connector_not_found": "errors.said.fillIn",
  "routine.mail_account_not_found": "errors.said.fillIn",
  "routine.name_required": "errors.said.fillIn",
  "routine.once_needs_time": "errors.said.fillIn",
  "routine.prompt_required": "errors.said.fillIn",
  "routine.schedule_required": "errors.said.fillIn",
  "storage.credentials_required": "errors.said.fillIn",
  "wiki.folder_required": "errors.said.fillIn",
  "wiki.title_required": "errors.said.fillIn",
  "browser.bad_address": "errors.said.checkAddress",
  "database.port": "errors.said.checkAddress",
  "database.url": "errors.said.checkAddress",
  "url.credentials": "errors.said.checkAddress",
  "url.https_required": "errors.said.checkAddress",
  "url.internal": "errors.said.checkAddress",
  "url.invalid": "errors.said.checkAddress",
  "url.not_found": "errors.said.checkAddress",
  "database.too_long": "errors.said.tooLong",
  "right_hand_approvals.guidance": "errors.said.tooLong",
  "status.too_long": "errors.said.tooLong",
  "wiki.body_too_long": "errors.said.tooLong",
  "account.runner_old": "errors.said.updateComputerApp",
  "machine.access_outdated": "errors.said.updateComputerApp",
  "machine.outdated": "errors.said.updateComputerApp",
  "machine.updates_itself": "errors.said.computerUpdatesItself",
  "database.disabled": "errors.said.offHere",
  "mail.composio_disabled": "errors.said.offHere",
  "mail.imap_disabled": "errors.said.offHere",
  "secret.computer_changed": "errors.said.offHere",
  "voice.unavailable": "errors.said.offHere",
  "reminder.agent_not_here": "errors.said.notInConversation",
  "reminder.person_not_here": "errors.said.notInConversation",
  "account.begin_failed": "errors.said.accountStart",
  "account.in_use": "errors.said.accountInUse",
  "ai.still_missing": "errors.said.noAiYet",
  "artifact.purged": "errors.said.filePurged",
  "block.secret": "errors.said.looksSecret",
  "block.spec": "errors.said.blockSpec",
  "browser.not_in_control": "errors.said.takeControl",
  "browser_profile.busy": "errors.said.profileBusy",
  "browser_profile.name_taken": "errors.said.nameTaken",
  "channel.delete_name": "errors.said.deleteName",
  "channel.general": "errors.said.generalKept",
  "channel.general_stays": "errors.said.generalStays",
  "connector.mcp_status": "errors.said.mcpUnreachable",
  "connector.mcp_unreachable": "errors.said.mcpUnreachable",
  "connector.not_approved": "errors.said.notApproved",
  "join.invited": "errors.said.alreadyInvited",
  "join.waiting": "errors.said.alreadyAsked",
  "mail.already_connected": "errors.said.mailboxConnected",
  "mail.send_without_asking_needs_recipients": "errors.said.sendNeedsRecipients",
  "mission.tasks_live": "errors.said.missionLive",
  "org.create_refused": "errors.said.createRefused",
  "reminder.no_agent": "errors.said.noAgentToRemind",
  "routine.connector_agent_cannot_read": "errors.said.agentCantRead",
  "routine.mail_agent_cannot_read": "errors.said.agentCantRead",
  "schedule.never": "errors.said.neverHappens",
  sole_owner: "errors.said.soleOwner",
  "storage.test_first": "errors.said.testFirst",
  "voice.bad_duration": "errors.said.voiceLength",
  "voice.too_large": "errors.said.voiceLength",
  "upload.expired": "errors.said.sendAgain",
  // The feedback form (ADR 0160): a file that went before the feedback was sent, or too many waiting to be sent.
  "feedback.files_gone": "errors.feedback.filesGone",
  "feedback.files_pending": "errors.feedback.filesPending",
  "upload.sha_mismatch": "errors.said.sendAgain",
  gif_key_env: "errors.said.serverKey",
  jev_key_env: "errors.said.serverKey",
  "oauth.link_expired": "oauthReturn.expired",
  "oauth.link_used": "oauthReturn.used",
  "oauth.other_account": "oauthReturn.otherAccount",
  "github_app.not_visible": "githubApp.notVisible",
  "github_app.other_workspace": "githubApp.otherWorkspace",
  "github_app.installed_outside": "githubApp.installedOutside",
  "github_app.owner_required": "githubApp.requested",
  "github_app.owner_unknown": "githubApp.ownerUnknown",
  "github_app.misconfigured": "githubApp.misconfigured",
  github_app_env: "githubApp.server.line.env",
} as const;

/** Better Auth's code when a blocked account tries to sign in (the server's `session.create.before` hook). */
export const ACCOUNT_BLOCKED = "ACCOUNT_BLOCKED";

/** Better Auth's code when an early-access link signs up another address than the one it was sent to. */
export const EARLY_ACCESS_OTHER_EMAIL = "EARLY_ACCESS_OTHER_EMAIL";

/**
 * Better Auth's refusal of a provider sign-in to an address whose password account isn't confirmed yet: it links none,
 * since whoever made that account may not own the address (mirrors apps/server auth.ts).
 */
export const ACCOUNT_NOT_LINKED = "account_not_linked";

/** Where a restriction on agentes.chat Cloud is contested. */
export const LEGAL_EMAIL = "legal@agentes.chat";

/** The reason agentes.chat Cloud's automatic hold is set with: it reads as the review line, never "on hold: review". */
const REVIEW_REASON = "review";

/**
 * Mirror of what agentes.chat Cloud's automatic hold names, as `review.<category>`: the review line says it. Any other
 * category reads as plain `review`.
 */
const REVIEW_FLAGGED = ["phishing_impersonation", "account_takeover", "fraud", "illegal_content"] as const;

/** The category a `review.<category>` reason names when the apps know it (`standing.cloud.reviewWhat`), else undefined. */
export const reviewFlaggedOf = (reason: string) =>
  REVIEW_FLAGGED.find((category) => reason === `${REVIEW_REASON}.${category}`);

/**
 * Reasons agentes.chat Cloud sets that rest on no Terms section, so nothing to contest: the automatic hold has a line
 * of its own, and `ended` holds a workspace whose plan ended, a billing matter.
 */
const UNCONTESTED: ReadonlySet<string> = new Set([REVIEW_REASON, "ended"]);

/**
 * What the server says of a restriction besides its code: the reason the workspace is told, and on agentes.chat
 * Cloud `cloud` (`"true"` in a run's values, which are text) with a held agent's or a blocked account's kind.
 */
export interface RestrictionFacts {
  reason?: unknown;
  kind?: unknown;
  cloud?: unknown;
}

/**
 * A restriction in the person's words, the one place the apps pick it: a workspace on hold, suspended or being
 * deleted and a held agent (the API's `org.paused`, `org.suspended`, `org.deleting` and `agent.paused`, or a run's
 * `run.org_paused`…), a refused workspace (`org.create_refused`) and a blocked account (`ACCOUNT_BLOCKED`). On
 * agentes.chat Cloud the line of its kind, with the Terms section and how to contest it. Elsewhere the words it always
 * had. Null for any other code.
 */
export function restrictionLine(
  t: TFunction,
  code: string | null | undefined,
  facts?: RestrictionFacts | null,
): string | null {
  const cloud = facts?.cloud === true || facts?.cloud === "true";
  const reason = typeof facts?.reason === "string" ? facts.reason.trim() : "";
  const kind = facts?.kind;
  const email = { email: LEGAL_EMAIL };
  const contested = (line: string) =>
    cloud && !UNCONTESTED.has(reason) ? `${endSentence(line)} ${t("standing.cloud.contest", email)}` : line;
  switch (code?.startsWith("run.") ? code.slice(4).replace("_", ".") : code) {
    case "org.paused": {
      // A billing hold (ADR 0079) is said in words of its own, never as the reason.
      const billing = billingHoldOf({ state: "hold", reason });
      if (billing) return t(`standing.billing.${billing}`);
      const flagged = reviewFlaggedOf(reason);
      if (cloud && flagged)
        return t("standing.cloud.reviewFor", { ...email, what: t(`standing.cloud.reviewWhat.${flagged}`) });
      if (cloud && (reason === REVIEW_REASON || reason.startsWith(`${REVIEW_REASON}.`)))
        return t("standing.cloud.review", email);
      return reason ? contested(t("standing.onHold", { reason })) : t("standing.paused");
    }
    case "org.suspended":
      return reason ? contested(t("standing.suspendedFor", { reason })) : t("standing.suspended");
    case "org.deleting":
      return t("errors.org.deleting");
    case "agent.paused":
      if (cloud && kind === "network") return t("standing.cloud.agentNetwork", email);
      if (cloud && kind === "operator") return t("standing.cloud.agentOperator", email);
      return t("standing.agentPaused");
    case "org.create_refused":
      return cloud ? t("standing.cloud.createRefused", email) : t("standing.createRefused");
    case ACCOUNT_BLOCKED:
      if (cloud && kind === "abuse") return t("standing.cloud.blockedAbuse", email);
      if (cloud && kind === "legal") return t("standing.cloud.blockedLegal", email);
      return contested(t("auth.accountBlocked"));
    default:
      return null;
  }
}

/** The hold banner's line: the reason when the workspace is told one, else what a refused run says. Null unless on hold. */
export function holdText(t: TFunction, standing: OrgStanding | null | undefined): string | null {
  if (standing?.state !== "hold") return null;
  return restrictionLine(t, "org.paused", standing);
}

/** The suspended screen's line: why, when the workspace is told, else that it is closed for now. */
export function suspendedText(t: TFunction, standing: Pick<OrgStanding, "reason" | "cloud"> | null | undefined) {
  const told = standing?.reason ? restrictionLine(t, "org.suspended", standing) : null;
  return told ?? t("standing.screen.text");
}

/**
 * Where a workspace on hold or suspended asks for help: the server's address (`SUPPORT_EMAIL`), else "ask the
 * people who run this server" (`support.ask`). On the Cloud nobody else runs it, so without an address, nothing.
 * Nothing either until `auth-config` answers.
 */
export function supportLineOf(
  config: Pick<AuthConfig, "supportEmail" | "workspaceComputer"> | undefined,
): { email: string } | "ask" | null {
  if (!config) return null;
  if (config.supportEmail) return { email: config.supportEmail };
  return config.workspaceComputer ? null : "ask";
}

/** "Continuar" refused: these say why (anything else is a plain "couldn't continue"). */
export const CONTINUE_ERRORS: ReadonlySet<string> = new Set([
  "run.not_continuable",
  "run.agent_busy",
  "run.continue_forbidden",
]);

export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : undefined);

/**
 * What the proxy in front answers while the server restarts, is down or too slow: Caddy's 502, 503 and 504, and
 * Cloudflare's 520 to 527 and 530 (as apps/web/public/unavailable.html reads them). The server's own errors carry a
 * code of theirs (its 503 for a computer's error does).
 */
const UNREACHABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/** No answer from the server itself, only from the proxy in front of it: it may be back in a moment. */
export const serverUnreachable = (error: unknown) =>
  error instanceof ApiError && UNREACHABLE.has(error.status) && error.code === `http_${error.status}`;

/**
 * A message that failed to go out with no answer at all (`fetch` throws a `TypeError`: no network), or only the
 * proxy's while the server restarts: it waits for the connection instead of failing. The server refusing it, or a
 * bug, fails it.
 */
export const sendWaits = (error: unknown) => error instanceof TypeError || serverUnreachable(error);

/**
 * `promise`, or a `NetworkError` once `ms` pass with no answer: a request a dead connection holds (after a sleep, a
 * proxy that went quiet) never settles on its own, and what waits on it would wait forever.
 */
export function answerWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NetworkError(new Error(`no answer in ${ms} ms`))), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** No answer from the server: none at all (`NetworkError`), or only the proxy's while it restarts or is down. */
export const noAnswer = (error: unknown) => error instanceof NetworkError || serverUnreachable(error);

/**
 * A known server code in the person's language, and any other limit (a 429, or `rate_limited`) as "too many tries",
 * since the server says those in English. Null for anything else (the caller keeps its own words). `locale`
 * writes the sizes a limit's refusal names.
 */
export function knownErrorText(t: TFunction, error: unknown, locale = "en"): string | null {
  if (!(error instanceof ApiError)) return null;
  const restriction = restrictionLine(t, error.code, error.params);
  if (restriction) return restriction;
  const limit = limitRefusalText(t, locale, error.code, error.params);
  if (limit) return limit;
  // An agent that doesn't answer this person (`audienceError`): whom it answers, by name.
  if (
    (error.code === "audience.only" || error.code === "audience.nobody") &&
    typeof error.params?.agentName === "string"
  ) {
    const g = agentGrammar(error.params.agentName);
    const names = Array.isArray(error.params.names)
      ? error.params.names.filter((n): n is string => typeof n === "string")
      : [];
    return names.length > 0
      ? t("audience.notice.only", { ...g, names: joinNames(names, t) })
      : t("audience.notice.nobody", g);
  }
  // The person who connected the mailbox is gone or unnamed: no blank name in the sentence.
  if (error.code === "mail.owner_only" && !error.params?.ownerName)
    return t("errors.mail.ownerOnlyUnknown", error.params);
  // `provider`: the provider whose key is missing, when the server could name it.
  if (error.code === "missing_credential" && typeof error.params?.provider === "string")
    return t("agentPage.activity.errors.missing_credential", error.params);
  // Own keys only: a code from an address (`/login?error=toString`) names no line of Object's.
  const key = Object.hasOwn(KNOWN, error.code) ? KNOWN[error.code as keyof typeof KNOWN] : undefined;
  if (key) return t(key, { max: MAX_UPLOAD_MB, ...error.params });
  // The server's validator refused a field: its English is for developers, never shown in any language.
  const issue = error.code === "invalid_request" ? error.params?.issue : undefined;
  if (typeof issue === "string")
    return t(
      Object.hasOwn(FIELD_ISSUES, issue) ? FIELD_ISSUES[issue as keyof typeof FIELD_ISSUES] : "errors.said.input",
    );
  return error.status === 429 || error.code === "rate_limited" ? t("common.tooMany") : null;
}

/** The kind of field a validation failure names (`params.issue`, apps/server http/errors.ts), by its words. */
const FIELD_ISSUES = {
  too_long: "errors.said.tooLong",
  too_many: "errors.said.tooMany",
  missing: "errors.said.fillIn",
} as const;

/** The app has its own line for this server code. */
export const hasWordsFor = (code: string) => Object.hasOwn(KNOWN, code);

/** What the request named isn't there anymore (deleted, archived, or never this person's to see): trying again won't help. */
export const isGone = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 410);

/**
 * `knownErrorText` for the person an invitation is for: a full workspace says whom to tell, never its numbers,
 * which are for its admins.
 */
export const invitedErrorText = (t: TFunction, error: unknown, locale?: string): string | null =>
  errorCode(error) === "org.members_full" ? t("errors.org.membersFull") : knownErrorText(t, error, locale);

/**
 * The device says it has no network: a browser's `navigator.onLine`. React Native has none, so the phone says the
 * server is out of reach instead.
 */
const deviceOffline = () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false;

/** No answer at all, in the person's words: offline, or the server out of reach. */
const noAnswerText = (t: TFunction) => t(deviceOffline() ? "common.offline" : "common.unreachable");

/**
 * The words of a refusal the app has no line for: in English, the server's own (written for people) for a 4xx and for
 * a computer's own refusal (its 503 `machine.<code>`); in any other language a plain line by what kind of refusal it
 * is, never English mid-screen. Something gone reads the plain line in every language: the server's "Agent not found"
 * says neither why nor what to do. Any other 5xx (a runner's `machine.internal` too) is for the log, and the person
 * reads that it failed on our side.
 */
function untranslatedText(t: TFunction, error: ApiError): string {
  const told = error.status < 500 || (error.code.startsWith("machine.") && error.code !== "machine.internal");
  if (!told || !error.message) return t("common.ourSide");
  if (isGone(error)) return t("errors.said.gone");
  if (readsEnglish(t)) return error.message;
  if (error.status >= 500) return t("errors.said.computer");
  return t(error.status === 409 ? "errors.said.conflict" : "errors.said.input");
}

/** The language the person's words come from is English: a plain `t` with no details is one a test made. */
function readsEnglish(t: TFunction) {
  const line = (t as unknown as (key: string, o: object) => string | { usedLng?: string })("common.close", {
    returnDetails: true,
  });
  return typeof line === "string" || !line.usedLng || line.usedLng.startsWith("en");
}

/**
 * A 403 in the person's words: a code the app knows, else that they can't do this, never the server's sentence (a
 * code with a why worth saying gets a line in `KNOWN`). Never "ask an admin": the person may be one, and the refusal
 * may not be about their role.
 */
export const forbiddenText = (t: TFunction, error: ApiError, locale?: string): string =>
  knownErrorText(t, error, locale) ?? t("common.notAllowed");

/**
 * A sign-in, sign-up or reset Better Auth refused (`{ status, code, message }`, a block's kind on agentes.chat Cloud)
 * in the person's words: too many tries, a blocked account and the bot check by their codes, no answer (status 0, or
 * only the proxy's), else `untranslatedText`.
 */
export function authErrorText(
  t: TFunction,
  refusal: { status: number; code?: string; message: string } & RestrictionFacts,
): string {
  if (refusal.status === 429) return t("auth.tooManyTries");
  if (refusal.status === 0) return noAnswerText(t);
  const { kind, cloud } = refusal;
  const error = new ApiError(refusal.status, refusal.code ?? `http_${refusal.status}`, refusal.message, {
    kind,
    cloud,
  });
  return knownErrorText(t, error) ?? (noAnswer(error) ? noAnswerText(t) : untranslatedText(t, error));
}

type ProviderRefusal = "cancelled" | "linked" | "noEmail" | "expired" | "server" | "other";

/** Better Auth's codes for a provider sign-in that didn't finish (`/login?error=`), by what the person can do. */
const PROVIDER_REFUSALS: Record<string, ProviderRefusal> = {
  access_denied: "cancelled",
  account_not_linked: "linked",
  unable_to_link_account: "linked",
  account_already_linked_to_different_user: "linked",
  email_does_not_match: "linked",
  email_not_found: "noEmail",
  email_not_verified: "noEmail",
  state_mismatch: "expired",
  state_not_found: "expired",
  invalid_code: "expired",
  no_code: "expired",
  please_restart_the_process: "expired",
  invalid_callback_request: "expired",
  nonce_binding_missing: "expired",
  issuer_mismatch: "expired",
  issuer_missing: "expired",
  server_error: "server",
  internal_server_error: "server",
  unable_to_get_user_info: "server",
  oauth_provider_not_found: "server",
  no_callback_url: "server",
};

/**
 * A provider sign-in the server refused (its code on `/login?error=`), in the person's words, or null for a code the
 * apps don't know. `emails`: the server sends email, so an unconfirmed account can be confirmed (else only its password
 * signs in).
 */
export function providerRefusalText(t: TFunction, code: string, emails: boolean): string | null {
  if (code === ACCOUNT_NOT_LINKED && !emails) return t("auth.unconfirmedNoEmail");
  return knownErrorText(t, new ApiError(403, code, ""));
}

/** A provider sign-in that didn't finish: a code the apps know, else Better Auth's by what the person can do. */
export function signInRefusalText(t: TFunction, code: string, emails: boolean): string {
  const known = providerRefusalText(t, code, emails);
  if (known) return known;
  const refusal: ProviderRefusal = (Object.hasOwn(PROVIDER_REFUSALS, code) && PROVIDER_REFUSALS[code]) || "other";
  return t(`auth.refused.${refusal}`);
}

/**
 * Why a provider's return didn't connect: the code the server's callback sends back (`?connector_error=`,
 * `?github_app_error=`), or the API's own code when the app finished it (the desktop app's window).
 */
const OAUTH_RETURNS = {
  cancelled: "oauthReturn.cancelled",
  expired: "oauthReturn.expired",
  "oauth.link_expired": "oauthReturn.expired",
  used: "oauthReturn.used",
  "oauth.link_used": "oauthReturn.used",
  other_account: "oauthReturn.otherAccount",
  "oauth.other_account": "oauthReturn.otherAccount",
  not_allowed: "common.notAllowed",
  forbidden: "common.notAllowed",
  not_visible: "githubApp.notVisible",
  "github_app.not_visible": "githubApp.notVisible",
  other_workspace: "githubApp.otherWorkspace",
  "github_app.other_workspace": "githubApp.otherWorkspace",
  installed_outside: "githubApp.installedOutside",
  "github_app.installed_outside": "githubApp.installedOutside",
  owner_required: "githubApp.requested",
  "github_app.owner_required": "githubApp.requested",
  owner_unknown: "githubApp.ownerUnknown",
  "github_app.owner_unknown": "githubApp.ownerUnknown",
  "github_app.misconfigured": "githubApp.misconfigured",
  requested: "githubApp.requested",
} as const;

/**
 * A provider's return that didn't connect, by its code, in the person's words (any other code: it failed). `params`:
 * what the code names (`connector.misconfigured`, its `provider`).
 */
export const oauthReturnText = (t: TFunction, code: string, params?: Record<string, unknown>): string => {
  if (Object.hasOwn(OAUTH_RETURNS, code)) return t(OAUTH_RETURNS[code as keyof typeof OAUTH_RETURNS]);
  // A connector account's own refusal comes as its full code (`connector.other_account`).
  if (code.startsWith("connector.") && Object.hasOwn(KNOWN, code)) return t(KNOWN[code as keyof typeof KNOWN], params);
  return t("oauthReturn.failed");
};

/** A key the provider refused on its test call, as a dialog says it: why, its words, and the page that fixes it. */
export function keyRefusal(t: TFunction, error: unknown): { text: string; href: string; site: string } | null {
  if (!(error instanceof ApiError) || !KEY_REFUSALS.has(error.code ?? "")) return null;
  const { provider = "", said = "" } = (error.params ?? {}) as { provider?: string; said?: string };
  const maker = providerOf(provider);
  const site = (error.code === "provider_key_no_credit" ? maker?.credit : undefined) ?? maker?.site;
  const why = errorText(t, error);
  return {
    text: said ? `${endSentence(why)} ${t("settings.keySaid", { provider, said })}` : why,
    href: site ? `https://${site}` : "",
    site: site?.split("/")[0] ?? "",
  };
}

const KEY_REFUSALS = new Set(["provider_key_invalid", "provider_key_no_credit", "provider_key_denied"]);

/**
 * A password manager's refusal to connect (`vault.source.<code>`, ADR 0144) in that source's own words when the app
 * has them (`vault.source.<kind>.error.<code>`: 1Password's token, its one vault), else as `errorText` says it.
 */
export function vaultConnectRefusal(t: TFunction, kind: string, error: unknown, locale?: string): string {
  const code = errorCode(error)?.match(/^vault\.source\.(\w+)$/)?.[1];
  const say = t as unknown as (key: string, options: Record<string, unknown>) => string;
  return (code && say(`vault.source.${kind}.error.${code}`, { defaultValue: "" })) || errorText(t, error, locale);
}

/**
 * A failed request in the person's words: a code the app knows, a file too big, a refusal, no answer (offline or the
 * server out of reach), else `untranslatedText`. Never a raw error's own words ("Failed to fetch", "Bad Gateway").
 */
export function errorText(t: TFunction, error: unknown, locale?: string): string {
  if (error instanceof ApiError) {
    const known = knownErrorText(t, error, locale);
    if (known) return known;
    if (error.status === 413) return t("errors.artifact.fileTooLarge", { max: MAX_UPLOAD_MB });
    if (error.status === 403) return forbiddenText(t, error, locale);
  }
  if (noAnswer(error)) return noAnswerText(t);
  return error instanceof ApiError ? untranslatedText(t, error) : t("common.unknownError");
}

const KEY_FAILURES = new Set([
  "run.missing_credential",
  "run.credential_revoked",
  "run.credential_wrong_provider",
  "run.provider_account",
  "run.provider_no_credit",
  "run.provider_invalid_key",
  "run.provider_no_access",
]);

/**
 * The one thing to do about a failed run, by its code, for someone who can: another key (`keys`: who manages them), or
 * another model (the agent's owner or who manages agents). Null when nothing fixes it or it's someone else's to do.
 */
export function failedRunFix(
  code: string | null | undefined,
  who: { keys: boolean; admin: boolean; owner: boolean },
): "useKey" | "changeModel" | null {
  if (code === "run.model_unlisted" || code === "run.provider_model_unavailable")
    return who.admin || who.owner ? "changeModel" : null;
  return code && KEY_FAILURES.has(code) && who.keys ? "useKey" : null;
}

/**
 * A failed run's reason in the reader's words, from the server's code (`run.stuck`, `run.computer_failed`): null for
 * an unknown code or a plain `run.failed`, whose own text is all there is.
 */
export function runErrorText(t: TFunction, code: string | null | undefined, params?: Record<string, unknown>) {
  const key = code?.replace(/^run\./, "");
  if (!key || key === "failed") return null;
  const say = t as unknown as (key: string, options: Record<string, unknown>) => string;
  return say(`agentPage.activity.errors.${key}`, { ...params, defaultValue: "" }) || null;
}

/**
 * A failed run as one line for the conversation: a restriction in its words, a computer that stayed busy, else
 * "couldn't answer" with the reason going on as part of the sentence. Null when no reason has words.
 */
export function runFailureLine(
  t: TFunction,
  agent: string,
  failure: { code?: string | null; params?: Record<string, unknown> },
  locale?: string,
): string | null {
  const refusal = restrictionLine(t, failure.code, failure.params);
  if (refusal) return t("channel.runRefused", { agent, reason: refusal });
  if (failure.code === "run.computer_busy") return t("channel.runBusy", { agent });
  const why = runErrorText(t, failure.code, failure.params);
  return why ? t("channel.runFailed", { agent, reason: lowerFirst(why.replace(/\.$/, ""), locale) }) : null;
}
