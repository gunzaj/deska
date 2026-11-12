"use client";

// The board layout with drag and drop (IMPROVEMENTS W3, SPEC §3 / M7).
// Dropping a card in another column edits the board's column field through
// the outbox (W2's optimistic edit: the card moves at once and snaps back
// with a toast if the write fails). With a Release to drop into (the Release
// page, or a board grouped by Release) a Backlog drawer lists open issues
// with no Release; dragging one onto the board plans it.
//
// Keyboard: focus a card, Space picks it up, ←/→ move between columns, Space
// drops, Esc cancels. Enter still opens the card. "Move to…" is in the card's
// context menu (right click, or the context-menu key / Shift+F10).
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { boardMove, cardDragId, draggable, NO_VALUE } from "@/lib/client/board-move";
import { rowKey } from "@/lib/client/list-nav";
import { boardColumns, CARD_PAGE, type BoardField, type DisplayProp } from "@/lib/client/explorer";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { useCells } from "./cells";
import { Icon } from "../icons";
import { useIssueEdits } from "../issue/edits";
import { Avatar, OptionDot, PriorityIcon, StatusIcon } from "../props";
import { PickList, Popover, btn } from "../ui/popover";


type DragData = { issue: ClientIssue; fromKey: string | null; backlog?: boolean };

/** Mouse first; the keyboard (no pointer) falls back to overlapping rects. */
const collisions: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

/** ←/→ jump a whole column; ↑/↓ do nothing (order within a column isn't stored). */
const columnJump: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (event.code !== "ArrowRight" && event.code !== "ArrowLeft") return undefined;
  const rect = context.collisionRect;
  if (!rect) return undefined;
  event.preventDefault();
  const cols = [...context.droppableRects.values()].sort((a, b) => a.left - b.left);
  const cx = rect.left + rect.width / 2;
  let at = cols.findIndex((r) => cx >= r.left && cx <= r.right);
  if (at < 0) at = cols.findIndex((r) => r.left > cx) - 1;
  const to = cols[event.code === "ArrowRight" ? Math.min(cols.length - 1, at + 1) : Math.max(0, at - 1)];
  if (!to) return undefined;
  return { x: currentCoordinates.x + (to.left + to.width / 2 - cx), y: currentCoordinates.y };
};

function CardBody({ issue, field, props }: { issue: ClientIssue; field: BoardField; props: DisplayProp[] }) {
  const c = useCells();
  const has = (p: DisplayProp) => props.includes(p);
  return (
    <>
      <div className="flex items-center gap-1.5">
        {has("id") && c.id(issue)}
        <span className="flex-1" />
        {has("assignee") && issue.assignees.length > 0 && c.assignee(issue)}
      </div>
      <p className={`mt-1 flex items-start gap-1.5 text-[13px] font-medium leading-snug ${issue.state === "closed" ? "text-muted" : ""}`}>
        {field !== "status" && has("status") && <span className="mt-[2px]">{c.status(issue)}</span>}
        <span className="line-clamp-3">
          <span data-peek-title>{issue.title}</span>
        </span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {field !== "priority" && has("priority") && c.priority(issue)}
        {has("subissues") && c.subissues(issue)}
        {field !== "release" && has("release") && c.release(issue)}
        {c.dims(issue, props, field)}
        {has("parent") && c.parent(issue)}
        {has("labels") && c.labels(issue, 2)}
        {field !== "type" && has("type") && c.type(issue)}
      </div>
    </>
  );
}

const CARD = "rounded-lg border bg-surface p-2.5 shadow-raised transition-colors";

/** One card. Memoized, with callbacks that take the issue so every card shares one function (v5 3.4). */
const BoardCard = memo(function BoardCard({
  issue,
  field,
  colKey,
  navKey,
  props,
  focused,
  peeked,
  canDrag,
  onOpen,
  onFocus,
  onMoveMenu,
  idPrefix = "",
}: {
  issue: ClientIssue;
  field: BoardField;
  colKey: string | null;
  /** This card's place in j/k order (an issue can have a card in several columns). */
  navKey: string;
  props: DisplayProp[];
  focused: boolean;
  /** This issue is open in the side panel (improvement 1). */
  peeked: boolean;
  canDrag: boolean;
  onOpen: (issue: ClientIssue) => void;
  onFocus: (navKey: string) => void;
  onMoveMenu?: (anchor: HTMLElement, issue: ClientIssue, fromKey: string | null) => void;
  idPrefix?: string;
}) {
  const data: DragData = { issue, fromKey: colKey, backlog: idPrefix === "backlog:" };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: cardDragId(issue.nodeId, colKey, idPrefix), data, disabled: !canDrag });
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        ref.current = el;
      }}
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
      // Reachable by Tab also when not draggable (U2); dnd-kit sets it when it is.
      {...(canDrag ? {} : { tabIndex: 0 })}
      onFocus={() => onFocus(navKey)}
      aria-roledescription={canDrag ? "draggable issue" : undefined}
      aria-label={`#${issue.number} ${issue.title}`}
      data-issue={issue.number}
      data-peek-row
      data-peeked={peeked ? "" : undefined}
      onClick={() => onOpen(issue)}
      onMouseMove={() => onFocus(navKey)}
      onKeyDown={(e) => {
        // Enter opens (dnd-kit only starts a drag on Space here).
        if (e.key === "Enter") onOpen(issue);
        if (canDrag) listeners?.onKeyDown?.(e);
      }}
      onContextMenu={(e) => {
        if (!onMoveMenu || !ref.current) return;
        e.preventDefault();
        onMoveMenu(ref.current, issue, colKey);
      }}
      className={`${CARD} cursor-default outline-none focus-visible:ring-2 focus-visible:ring-focus ${isDragging ? "opacity-40" : ""} ${peeked ? "border-brand-border" : focused ? "border-line-field-hover" : "border-line hover:border-line-field"}`}
    >
      <CardBody issue={issue} field={field} props={props} />
    </div>
  );
});

function Column({ colKey, children, className }: { colKey: string; children: ReactNode; className: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  return (
    <section ref={setNodeRef} data-column={colKey} data-over={isOver || undefined} className={`${className} ${isOver ? "ring-2 ring-brand-border" : ""}`}>
      {children}
    </section>
  );
}

export function BoardLayout({
  rows,
  field,
  props,
  focusedKey,
  onFocus,
  onOpen,
  dropRelease,
  peeked,
}: {
  rows: ClientIssue[];
  field: BoardField;
  props: DisplayProp[];
  /** The focused card's place (`rowKey(column, nodeId)`). */
  focusedKey: string | null;
  onFocus: (navKey: string) => void;
  onOpen: (i: ClientIssue) => void;
  /** The Release a backlog card dropped on this board gets (the Release page). */
  dropRelease?: string | null;
  /** The issue open in the side panel (improvement 1). */
  peeked?: number | null;
}) {
  const { data, option } = useAppData();
  const { edit, disabledReason } = useIssueEdits();
  const { meta } = data;
  const cols = useMemo(() => boardColumns(rows, field, meta), [rows, field, meta]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; issue: ClientIssue; fromKey: string } | null>(null);
  const openMoveMenu = useCallback((anchor: HTMLElement, issue: ClientIssue, fromKey: string | null) => setMenu({ anchor, issue, fromKey: fromKey ?? "" }), []);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const canDrag = !disabledReason && draggable(field);
  // A Release to plan into: the page's, or each column's on a board by Release.
  const planInto = field === "release" || !!dropRelease;
  const backlog = useMemo(() => (planInto ? data.issues.filter((i) => i.state === "open" && !i.releaseId) : []), [planInto, data.issues]);
  // Hide empty "No value" columns; keep empty option columns so the flow reads.
  const shown = cols.filter((c) => c.rows.length || c.key !== NO_VALUE);
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click still opens.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnJump, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const move = (issue: ClientIssue, fromKey: string | null, toKey: string, fromBacklog: boolean) => {
    if (fromBacklog) {
      const release = field === "release" ? (toKey === NO_VALUE ? null : toKey) : (dropRelease ?? null);
      if (release) void edit(issue, "release", release);
      return;
    }
    const m = boardMove(issue, field, fromKey ?? NO_VALUE, toKey);
    if (m) void edit(issue, m.field, m.next);
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as DragData | undefined) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const d = e.active.data.current as DragData | undefined;
    if (!d || !e.over) return;
    move(d.issue, d.fromKey, String(e.over.id), !!d.backlog);
  };

  const iconOf = (key: string): ReactNode => {
    if (field === "status") return <StatusIcon option={option("status", key)} total={meta.fields.status.length} />;
    if (field === "priority") return <PriorityIcon option={option("priority", key)} total={meta.fields.priority.length} />;
    if (field === "assignee") return key === NO_VALUE ? <Icon name="user" size={14} className="text-faint" /> : <Avatar login={key} size={16} />;
    if (field === "release") return <Icon name="calendar" size={13} className="text-faint" />;
    return null;
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex h-full flex-col">
        {planInto && (
          <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
            <button
              type="button"
              aria-pressed={backlogOpen && !disabledReason}
              disabled={!!disabledReason}
              data-planning-disabled={disabledReason ? "" : undefined}
              title={disabledReason ?? undefined}
              onClick={() => setBacklogOpen((o) => !o)}
              className={btn.outline}
            >
              <Icon name={disabledReason ? "lock" : "inbox"} size={13} /> Backlog <span className="tabular-nums text-faint">{backlog.length}</span>
            </button>
            {disabledReason ? <span className="text-[12px] text-faint">{disabledReason}: dragging and the backlog drawer are off.</span> : backlogOpen && <span className="text-[12px] text-faint">Drag an issue onto the board to plan it into the Release.</span>}
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-2.5 overflow-x-auto p-3">
          {backlogOpen && planInto && !disabledReason && (
            <section aria-label="Backlog" className="flex w-[17.5rem] shrink-0 flex-col rounded-xl border border-dashed border-line bg-bg/40">
              <h2 className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12.5px] font-semibold">
                <Icon name="inbox" size={13} className="text-faint" />
                Backlog <span className="font-normal tabular-nums text-faint">{backlog.length}</span>
              </h2>
              <div className="flex min-h-12 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-2">
                {backlog.slice(0, CARD_PAGE).map((i) => (
                  <BoardCard key={i.nodeId} idPrefix="backlog:" issue={i} field={field} colKey={null} navKey={`backlog:${i.nodeId}`} props={props} focused={`backlog:${i.nodeId}` === focusedKey} peeked={i.number === peeked} canDrag onOpen={onOpen} onFocus={onFocus} />
                ))}
                {backlog.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-faint">Nothing unplanned</p>}
              </div>
            </section>
          )}
          {shown.map((col) => {
            const limit = limits[col.key] ?? CARD_PAGE;
            return (
              <Column key={col.key} colKey={col.key} className="flex w-[17.5rem] shrink-0 flex-col rounded-xl bg-bg/70">
                <h2 className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12.5px] font-semibold">
                  {iconOf(col.key) ?? <OptionDot color={col.color} />}
                  <span className="truncate">{col.label}</span>
                  <span className="font-normal tabular-nums text-faint">{col.rows.length}</span>
                </h2>
                <div className="flex min-h-12 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-2" title={!canDrag && disabledReason ? disabledReason : undefined}>
                  {col.rows.slice(0, limit).map((i) => (
                    <BoardCard
                      key={i.nodeId}
                      issue={i}
                      field={field}
                      colKey={col.key}
                      navKey={rowKey(col.key, i.nodeId)}
                      props={props}
                      focused={rowKey(col.key, i.nodeId) === focusedKey}
                      peeked={i.number === peeked}
                      canDrag={canDrag}
                      onOpen={onOpen}
                      onFocus={onFocus}
                      onMoveMenu={canDrag ? openMoveMenu : undefined}
                    />
                  ))}
                  {col.rows.length > limit && (
                    <button
                      type="button"
                      onClick={() => setLimits((l) => ({ ...l, [col.key]: limit + CARD_PAGE * 2 }))}
                      className="h-8 rounded-md text-[12px] text-muted hover:bg-hover hover:text-fg"
                    >
                      Show {Math.min(col.rows.length - limit, CARD_PAGE * 2)} more
                    </button>
                  )}
                  {col.rows.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-faint">No issues</p>}
                </div>
              </Column>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className={`${CARD} w-[16.5rem] rotate-1 border-line-field-hover`}>
            <CardBody issue={dragging.issue} field={field} props={props} />
          </div>
        )}
      </DragOverlay>
      <Popover anchor={{ current: menu?.anchor ?? null }} open={menu != null} onClose={() => setMenu(null)} width={240}>
        {menu && (
          <PickList
            placeholder="Move to…"
            items={shown.filter((c) => c.key !== menu.fromKey).map((c) => ({ id: c.key, label: c.label || "No value", icon: iconOf(c.key) ?? <OptionDot color={c.color} /> }))}
            onPick={(key) => {
              move(menu.issue, menu.fromKey, key, false);
              setMenu(null);
            }}
          />
        )}
      </Popover>
    </DndContext>
  );
}
