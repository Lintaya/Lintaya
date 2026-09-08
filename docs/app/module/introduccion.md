# Boards

English | [Español](introduccion.es.md)

A Board is a persistent Module Builder page. It has a title, icon, active state,
independent sidebar visibility, and a zone tree that places Blocks in ordered stacks. The CLI calls these
pages Boards; API and stored identifiers still use module-pages for
compatibility.

## Choose a layout

Open **Boards → New Board**, or select **Edit Board** on a saved Board. A title
is required to save. The icon identifies it; **Active** makes it available and
**In sidebar** controls its sidebar shortcut.

The editor has a block catalog, zone layout and preview. Drag the editor column
separators to adjust their widths. Close **Board layout** to expand the preview;
**Show layout** restores it. These controls arrange the editor, not the Board.

| Preset | Use |
|---|---|
| 1 zone | Start with one main zone. |
| Columns | Place content side by side. |
| Rows | Place content vertically. |
| Grid | Combine rows and columns. |
| Priority / Focus | Start with a composition giving one zone more space. |

Choose a preset first, check the preview after changing it, then resize zones
using their separators.

## Place and rearrange blocks

1. Enable **Add blocks** and select a layout zone.
2. Search **Available blocks** by name or filter by connection.
3. Select a block to add it to the chosen zone.
4. Adding to an occupied zone creates a sibling panel with its own separator.
5. Use up/down arrows to reorder multiple blocks within a zone. To move between
   zones, remove the placement and add the block to the destination.
6. Check the preview and select **Save and apply**.

Mix Markdown, HTML and connector blocks in the same Board. Reuse catalog blocks
in other Boards. Edit content in Blocks; the Board controls its placement.

In **Edit zones**, select a zone to split it and use the orientation control to
choose the direction. Removing a zone changes the layout; check the result
before saving. Empty zones compact and cannot serve as persistent blank spacers.

## Margins, spacing and size

There is currently no field for numeric per-Board or per-block margins or
padding. The application defines outer margins, panel gaps and card padding.

You can adjust zone width and height proportions: drag a separator, or focus it
with Tab and use arrow keys. Each Board saves its own proportions. Wider zones
help with titles and tables; taller zones show more rows before scrolling.

Cards fit their content instead of filling the whole zone with blank space.
Overflowing content scrolls inside the block. A zone may retain unused space;
resize its separators or change the composition to redistribute it. Pagination
changes the displayed items; scrolling reaches controls below the visible area.

On narrow screens, zones flow vertically. Check that layout too when sharing
with mobile users.


## Create a Board

1. Open Module Builder, then choose New Board.
2. Enter a clear title and choose an icon.
3. Keep the Board active so it can be opened, or make it inactive while preparing it.
4. Use **In sidebar** to choose whether an active Board appears in the sidebar.
5. Select a layout preset or edit zones to create the desired structure.
6. Choose a zone, switch to Add blocks, and add available blocks to its stack.
7. Choose Save and apply.

The page becomes a navigable Board only when it is active. An active Board with
**In sidebar** disabled remains available from the Boards catalog and by its
route, but does not occupy sidebar space. Boards saved before this option existed
default to visible. Saving records both states independently.

## Compose the layout

A Board uses zones rather than free-form absolute positioning. A zone contains
an ordered stack of block ids; a block may be placed on more than one Board
without copying its content. Use Edit zones to split, combine, or choose a
preset, then use Add blocks to fill the selected zone.

The rendered Board behaves as a reflowing workspace. Every placed Block has a
visible close control. Closing it removes only that placement from the current
Board: the global Block, connector configuration, synchronized data, and any
placement on another Board remain unchanged. If the zone becomes empty, its
occupied sibling expands into the released space; closing the last Block shows
a clear empty state with an action that reopens the Block selector.

Adding a Block to an empty zone reuses that zone. If the zone already contains
content, Builder automatically creates a 50/50 sibling pane with its own
separator, so closing and later adding Blocks does not remove the ability to
resize them. The result still uses the same compatible Board tree.

Resize the separators between occupied zones with pointer input or with the
arrow keys while a separator is focused. Split ratios are stored in this
Board's own tree, so resizing one Board does not affect another. On a narrow
screen the zones reflow into a full-width vertical workspace and retain the
same ordered content and accessible resize controls.

On desktop, if content no longer fits after resizing, only the Block body gets
a thin scrollbar; its header and close control remain visible. The body is
reachable with Tab and supports arrow keys, Page Up, and Page Down. On mobile,
content keeps its natural flow without an internal scrollbar.

Missing blocks are shown as unavailable rather than silently replaced. Configure
and synchronize a connector before adding a connector-owned block. An
unavailable placement still has a close control, so it cannot trap an empty
region in the layout.

## Edit or delete safely

Open an existing Board from Module Builder to change its title, icon, active
state, sidebar visibility, layout, or blocks. Marking it inactive disables its
route but keeps it editable and stored; hiding it from the sidebar does not
deactivate it.

Deleting a Board removes only its page and placements. It does not delete the
Markdown blocks, connector blocks, connections, provider configuration, or
remote provider data used by that Board.

## Future portability

Board trees continue to store local Block references for compatibility, but
those identifiers are treated as references rather than owned content. A future
versioned export package can translate them into portable resource keys and map
connector requirements to Connections on another Lintaya installation. The
future Dashboard and sharing phases are planned separately; neither concept is
created by the current Board workspace phase.
