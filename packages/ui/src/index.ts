/**
 * @agenteschat/ui — the agentes design system in React.
 * Visuals come from `styles.css` (tokens + `ac-*` classes, ported from
 * docs/design); keyboard, focus and screen-reader mechanics from Radix
 * primitives. Components take every user-facing string as a prop: the app
 * translates them with `t()`.
 */

export {
  ACCESSORIES,
  ACCESSORY_REACH,
  AGENT_GRADIENTS,
  BODY_CUT,
  BODY_RADIUS,
  bodyPath,
  bodySvg,
  bodyTones,
  colorKey,
  drawAccessory,
  drawAgent,
  drawEyes,
  EXPRESSIONS,
  type Expression,
  EYE_STYLES,
  eyeShapes,
  gradientOf,
  hexToHsv,
  hsvToHex,
  idlePose,
  isHexColor,
  type Pose,
  spriteGrid,
} from "./agent/engine.js";
export {
  type AgentReaction,
  addLiveAgent,
  agentReactionOf,
  getGaze,
  playAgentReaction,
  REACTION_SECONDS,
  reactionPose,
  setGaze,
} from "./agent/live";
export { addLiveSticker, liveStickerCount } from "./agent/sticker-live";
export {
  drawSticker,
  STICKER_MOODS,
  STICKER_STILL_T,
  type StickerLook,
  type StickerMood,
  stickerSeed,
  WAVE_SECONDS,
} from "./agent/stickers";
export {
  BRAIN_GRID,
  BRAIN_KINDS,
  BRAIN_STATES,
  type BrainAgentLook,
  drawBrain,
} from "./brain/portrait.js";
export { channelQuery, insertChannelRef } from "./channel-refs";
export {
  type AccessBase,
  AccessDialog,
  type AccessDialogLabels,
  type AccessDialogProps,
  type AccessLevel,
  type AccessSubject,
} from "./components/AccessDialog";
export {
  AGENT_ACCESSORIES,
  AGENT_COLORS,
  AGENT_EYES,
  type AgentAccessory,
  type AgentAppearance,
  type AgentColor,
  type AgentEyes,
  agentGradient,
  appearanceStyle,
  normalizeAppearance,
  randomAppearance,
} from "./components/AgentLook";
export { AgentSticker, type AgentStickerProps } from "./components/AgentSticker";
export { ApprovalCard, type ApprovalCardProps, type ApprovalStatus } from "./components/ApprovalCard";
export { type AutonomyKind, AutonomyPixels, drawAutonomy } from "./components/AutonomyPixels";
export {
  type AgentState,
  Avatar,
  type AvatarKind,
  type AvatarProps,
  AvatarStack,
} from "./components/Avatar";
export {
  BRAIN_ICONS,
  BrainIcon,
  BrainLogo,
  BrainPortrait,
  type BrainPortraitKind,
  type BrainPortraitProps,
  type BrainPortraitState,
} from "./components/Brain";
export { Button, type ButtonProps, type ButtonVariant, SwapLabel } from "./components/Button";
export { CardHorizon, horizonCrest, horizonHeight, horizonTones } from "./components/CardHorizon";
export { type CardCut, CardMore, useCardCut } from "./components/CardMore";
export { Carousel, type CarouselProps } from "./components/Carousel";
export { CHAT_GIF_MAX, ChatGif, type ChatGifProps } from "./components/ChatGif";
export {
  Checkbox,
  CheckboxPill,
  type CheckboxProps,
  Radio,
  RadioCard,
  RadioGroup,
  Switch,
} from "./components/Checkbox";
export { AttentionNote, Chip, type ChipProps, type ChipTone, CountBadge, CountChip } from "./components/Chip";
export { CodeInput, type CodeInputProps } from "./components/CodeInput";
export { ColorPicker, type ColorPickerLabels } from "./components/ColorPicker";
export { CommandPalette, filterPalette, type PaletteItem } from "./components/CommandPalette";
export {
  Composer,
  type ComposerChoice,
  type ComposerCommand,
  type ComposerCommands,
  ComposerFile,
  type ComposerFormatLabels,
  type ComposerMentions,
  type ComposerProps,
  type ComposerSuggestion,
  type ComposerVoice,
  type ComposerWorking,
  linkQuery,
  mentionQuery,
  type SendChoice,
  sendChoice,
} from "./components/Composer";
export {
  ComputerIcon,
  type ComputerKind,
  ComputerPortrait,
  type ComputerPortraitProps,
  type ComputerState,
  type PhoneKind,
  type PortraitKind,
} from "./components/Computer";
export { DatePicker, type DatePickerProps, monthGrid, parseYmd, ymd } from "./components/DatePicker";
export {
  DetailsDialog,
  type DetailsDialogPageLink,
  type DetailsDialogProps,
  DetailsSection,
} from "./components/DetailsDialog";
export {
  Dialog,
  DialogBody,
  DialogFooter,
  type DialogProps,
  DialogSearchList,
  useUnsavedInDialog,
} from "./components/Dialog";
export { Diff, type DiffBlock, type DiffKind, type DiffLine, diffBlocks, diffLines } from "./components/Diff";
export { drawEffort, EffortPixels, type EffortStep } from "./components/EffortPixels";
export {
  EMOJI_COLUMNS,
  EmojiPicker,
  type EmojiPickerLabels,
  EmojiPickerPopover,
  type PickerTab,
  readRecentEmoji,
  rememberEmoji,
} from "./components/EmojiPicker";
export {
  EventPill,
  EventPillAction,
  type EventPillActionProps,
  EventPillMore,
  type EventPillProps,
} from "./components/EventPill";
export { FactLine, type LineFact, type LineFactTone } from "./components/FactLine";
export { type Fact, FactStrip, type FactTone } from "./components/FactStrip";
export {
  AffixInput,
  Field,
  type FieldProps,
  FormActions,
  FormStack,
  Input,
  Locked,
  PickerHeading,
  SearchInput,
  Textarea,
  useAutoGrow,
  useFieldControl,
  useLocked,
} from "./components/Field";
export {
  FILTER_SEARCH_AFTER,
  FilterBar,
  FilterChip,
  type FilterChipProps,
  type FilterOption,
} from "./components/FilterChip";
export { GroupHeading } from "./components/GroupHeading";
export { InfoHint, type InfoHintProps } from "./components/InfoHint";
export { isApple, Kbd, modKey, shortcut } from "./components/Kbd";
export { Logo, LogoMark, type LogoProps } from "./components/Logo";
export {
  GifPicker,
  type GifPickerLabels,
  masonryColumns,
  type PickerAgent,
  type PickerGif,
  StickerPicker,
  type StickerPickerLabels,
  stickerMoodsFor,
} from "./components/MediaPicker";
export { Mention } from "./components/Mention";
export {
  Menu,
  MenuAt,
  MenuCheckboxItem,
  MenuFace,
  MenuHeading,
  MenuItem,
  MenuNote,
  MenuRadioGroup,
  MenuReactions,
  MenuSeparator,
  MenuSub,
} from "./components/Menu";
export {
  MenuOverlay,
  MenuOverlayGroup,
  MenuOverlayItem,
  MenuOverlaySeparator,
} from "./components/MenuOverlay";
export {
  DayDivider,
  Message,
  type MessageLook,
  MessageLookContext,
  type MessageProps,
  MessageText,
} from "./components/Message";
export { stopPlayback } from "./components/media-playback";
export { OptionList, type OptionListItem, type OptionListProps } from "./components/OptionList";
export { PageHeader, type PageHeaderProps } from "./components/PageHeader";
export {
  PixelDone,
  type PixelDoneProps,
  PixelFail,
  PixelStop,
  type PixelStopProps,
  pixelCell,
} from "./components/PixelMarks";
export { glowOptions, PixelSky, SkyGlow } from "./components/PixelSky";
export {
  ORBIT_RING,
  ORBIT_STEP_MS,
  orbitShades,
  PixelSpinner,
  type PixelSpinnerProps,
  type PixelSpinnerSize,
} from "./components/PixelSpinner";
export {
  limitOffers,
  type OfferAccount,
  PLAN_ALMOST,
  PLAN_CRITICAL,
  PLAN_TONE,
  type PlanLevel,
  PlanMeter,
  type PlanMeterText,
  type PlanMeterUsage,
  type PlanMeterWindow,
  type PlanState,
  planLevel,
  planLine,
  planState,
  planWindows,
} from "./components/PlanMeter";
export { Popover } from "./components/Popover";
export { type BadgePresence, PresenceBadge, type PresenceBadgeProps } from "./components/PresenceBadge";
export {
  ProviderLogo,
  type ProviderLogoProps,
  ProviderStack,
  type ProviderStackProps,
} from "./components/ProviderLogo";
export { QrCode } from "./components/QrCode";
export {
  modeOf,
  monthlyKindOf,
  type RecurrenceLabels,
  type RecurrenceMode,
  RecurrencePicker,
  type RecurrencePickerProps,
} from "./components/RecurrencePicker";
export { RoleMark } from "./components/RoleMark";
export {
  BrowserMark,
  type BrowserPixelKind,
  BrowserStrip,
  CriteriaPixels,
  ExpiryFuse,
  type MonthDay,
  MonthRuns,
  PageSilhouette,
  PlanStrip,
  type PlanStripCell,
  planCellPixel,
  RunKey,
  RunLane,
  RunMark,
  type RunPixel,
  type RunPixelStatus,
  RunStrip,
  SkyStrip,
  STRIP_CELL,
  WorkSweep,
} from "./components/RunPixels";
export { SavedNote } from "./components/SavedNote";
export { AgentSearching } from "./components/SearchPixels";
export { SearchSelect, type SearchSelectLabels, type SearchSelectProps } from "./components/SearchSelect";
export { Segmented, type SegmentedOption, SplitButton } from "./components/Segmented";
export { ChosenValue, Select, type SelectOption, type SelectProps } from "./components/Select";
export { SettingNote, SettingRow, SettingsMore, SettingsSection } from "./components/Settings";
export { SettingsPath } from "./components/SettingsPath";
export {
  SKELETON_DELAY_MS,
  Skeleton,
  SkeletonCard,
  SkeletonConversation,
  SkeletonConversationRows,
  SkeletonGroup,
  SkeletonList,
  SkeletonMessage,
  type SkeletonProps,
  SkeletonRow,
  Spinner,
  skeletonOnScreen,
  TopProgress,
  useDelayed,
} from "./components/Skeleton";
export { StepTrack, type StepTrackState, type StepTrackStep } from "./components/StepTrack";
export {
  Alert,
  Card,
  CardFooter,
  CardHeader,
  EmptyState,
  type EmptyStateProps,
  LIST_STAGGER_MS,
  List,
  ListRow,
  type ListRowProps,
  Meter,
  OptionCard,
  Steps,
} from "./components/Surfaces";
export { type TabItem, TabPanel, Tabs } from "./components/Tabs";
export { normalizeTime, TimeSelect, type TimeSelectProps, timeOptions } from "./components/TimeSelect";
export { TimezoneSelect, type TimezoneSelectLabels, type TimezoneSelectProps } from "./components/TimezoneSelect";
export { Tip, type TipProps } from "./components/Tip";
export { Token, TokenList } from "./components/Token";
export {
  ToolBlock,
  type ToolBlockHead,
  type ToolBlockItem,
  type ToolBlockLine,
  type ToolBlockState,
} from "./components/ToolBlock";
export {
  FilterToggle,
  type FilterToggleProps,
  SearchField,
  type SearchFieldProps,
  Toolbar,
} from "./components/Toolbar";
export {
  AskPixels,
  HappyAgent,
  SuggestSpark,
  TOOL_LEVEL_ORDER,
  ToolLevelBar,
  type ToolLevelKind,
  ToolLevelStrip,
  ToolLevelSwatch,
  toolLevelTones,
} from "./components/ToolPixels";
export { type UsageDay, type UsageDayPart, UsageDays, UsageSwatch } from "./components/UsageDays";
export { VideoPlayer, type VideoPlayerLabels, type VideoPlayerProps } from "./components/VideoPlayer";
export {
  stopVoicePlayback,
  VoicePlayer,
  type VoicePlayerLabels,
  type VoicePlayerProps,
} from "./components/VoicePlayer";
export {
  type VoiceNotice,
  type VoiceTake,
  voiceRecordingSupported,
} from "./components/voice-recorder";
export { Reaction, Reactions, type WorkStep, WorkSummary } from "./components/Work";
export { WorkLine, WorkLineAction, type WorkLineTone, WorkPlan } from "./components/WorkLine";
export { COMPUTER_GRID, COMPUTER_KINDS, COMPUTER_STATES, drawComputer, PHONE_KINDS } from "./computer/portrait.js";
export { cx } from "./cx";
export { hoverPointer, movesByKeys, onScreenKeyboard, onScreenNow, trackInput } from "./device";
export {
  EMOJI_CATEGORIES,
  EMOJIS,
  type EmojiCategoryId,
  type EmojiEntry,
  emojiEntry,
  searchEmoji,
} from "./emoji-data";
export {
  applyFormat,
  codeBlock,
  FORMAT_KINDS,
  type FormatKind,
  formatShortcut,
  formatShortcutHint,
  insertText,
  linkSelection,
  prefixLines,
  type TextEdit,
  wrapSelection,
} from "./format";
export { useDarkTheme } from "./hooks/useDarkTheme";
export { useDragScroll } from "./hooks/useDragScroll";
export {
  HOVER_CLOSE_MS,
  HOVER_SWITCH_MS,
  type HoverCard,
  type HoverCardOpen,
  useHoverCard,
} from "./hooks/useHoverCard";
export { matchesNow, TOUCH, useMatchMedia } from "./hooks/useMatchMedia";
export { useNow } from "./hooks/useNow";
export { type ScrollSides, useScrollSides } from "./hooks/useScrollSides";
export { Icon, type IconName, type IconProps, iconNames, icons } from "./icons/Icon";
export { driveFolder, initialsOf, isIdHandle } from "./names";
export {
  BGS as PERSON_BACKGROUNDS,
  CATALOG as PERSON_CATALOG,
  cleanRecipe,
  cropFor as personCropFor,
  DEFAULT as PERSON_DEFAULT,
  decodeRecipe,
  encodeRecipe,
  FIELDS as PERSON_FIELDS,
  type PersonBuild,
  type PersonField,
  type PersonRecipe,
  PORTRAIT_MARK,
  randomPerson,
  recipeOfUrl,
  renderPerson,
  swatchOf as personSwatchOf,
} from "./person/engine.js";
export { PersonPortrait } from "./person/PersonPortrait";
export {
  BUSINESS_DAYS,
  nextOccurrences,
  type RecurrenceFreq,
  type RecurrenceRule,
  ruleFor,
  WEEKDAYS,
  type Weekday,
  weekdayOf,
  weekdayOfYmd,
  weekdayPosition,
  zonedInstant,
} from "./recurrence";
export { fold, matchesWords } from "./search";
export { pixelBurst, pixelConfetti } from "./sky/burst";
export { ditherCells, ditherSvg, ditherTones, ditherUrl } from "./sky/dither";
export {
  drawSprite,
  holdSkies,
  prefersReducedMotion,
  redrawSkies,
  type SkyBlob,
  type SkyFrame,
  type SkyOptions,
  SPRITE,
  startSky,
} from "./sky/engine";
export { selectionSkyUrl } from "./sky/selection";
export { agentTones, EYE, glowTones, mix, parseColor, pixelOf, SKY_TONES, softTones, spriteTone } from "./sky/tones";
export {
  cloudAt,
  HEADER_AREA,
  headerField,
  isDarkSurface,
  type SkyHour,
  skyHourOf,
  starAt,
  workspaceInk,
  workspaceTones,
} from "./sky/workspace";
export {
  allZones,
  cityOf,
  FALLBACK_ZONES,
  filterZones,
  isEuropeanTimeZone,
  offsetLabel,
  offsetMinutes,
  parseOffsetQuery,
  regionOf,
  type ZoneOption,
  type ZoneRegion,
  zoneOption,
  zoneOptions,
} from "./timezones";
export { DitherLine, fillEnds, paintCells, paintLineArea, useElementWidth } from "./widgets/ChartPieces";
export { formatWidgetNumber, formatWithUnit, useCountUp, widgetDigits } from "./widgets/format";
export { ditherTile, WIDGET_CELL, widgetTileVars, widgetTones } from "./widgets/tiles";
export { BuildingDither, WidgetBody, type WidgetBodyProps } from "./widgets/WidgetBody";
export {
  type CardBoardLabels,
  WidgetBleed,
  WidgetCard,
  type WidgetCardProps,
  type WidgetOrganize,
} from "./widgets/WidgetCard";
export { WidgetGlyph } from "./widgets/WidgetGlyph";
