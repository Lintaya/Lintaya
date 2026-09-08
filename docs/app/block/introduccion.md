# Blocks

English | [Español](introduccion.es.md)

A block is reusable content. A Board arranges blocks in zones; a Dashboard groups
Boards into tabs. The same block can appear in multiple Boards without copying
its content.

## Block types

| Type | Content | Updates |
|---|---|---|
| Static Markdown (.md) | Text, lists, tables, links, code and Mermaid diagrams. | Edit and save the content. |
| Static HTML | An HTML fragment containing headings, paragraphs, lists or tables. | Edit and save the content. |
| Dynamic connector | Commits, repositories, tasks, documents and other provider data. | Connection reads and synchronization. |

The editor labels Markdown/HTML content **IA**, but you can paste handwritten
content without generating anything. AI-generated text remains static; its saved
prompt never runs automatically. Dynamic data is not necessarily real-time: it
depends on the connector's cache and synchronization schedule.

## Create a Markdown or HTML block

1. Open **Blocks → + New block**.
2. Enter a title and optionally a description and icon.
3. Select **IA** under **Type**, then choose **Markdown** or **HTML**.
4. Choose **External** to type or paste into **Content**. For a .md or .html
   file, copy its contents into the editor. This saves text, not a live file reference.
5. Check the preview and keep the block active for catalog availability.
6. Select **Save block**.

Title and content are required. Example Markdown:

```md
## Daily review
- Check alerts
- Review pending tasks
```

Equivalent HTML fragment:

```html
<h2>Daily review</h2>
<ul><li>Check alerts</li><li>Review pending tasks</li></ul>
```

HTML is sanitized before display. It is not an executable application or a place
for scripts. Omit html, head and body wrappers. Use HTTP(S) URLs for images and
video rather than inline data: or blob: content.

In **Local** mode, enter a prompt to generate content using the AI provider
configured in Settings. Review the output before saving. Local is the editor's
mode label; it does not imply that the model runs on your computer.

## Create a dynamic connector block

1. Configure, enable and sync the connection in **Connectors**.
2. Open **Blocks → + New block** and choose **Connector**.
3. Choose the connection and one of its offered blocks.
4. Adjust scope and item count using the available options.
5. Enter a descriptive title, review the preview and save.

You can also add a predefined connector block directly to a Board. A custom
block saves your own configuration, such as a different scope or limit. Only
block types and filters implemented by that connector are available. Sync needs
a working connection.

## Reuse a block across Boards

1. Create or edit a Board from **Boards**.
2. Find the block in **Available blocks**, using search or the connection filter.
3. Select a destination zone and add the block.
4. Select **Save and apply**.
5. Repeat in another Board, selecting the same catalog block.

Each Board retains its layout and sizing. Block content and configuration are
shared: Boards referencing an edited block load the new version when their data
reloads. Create separate blocks for independent variants.

Removing a block from a Board removes only that placement, not its library
record or remote data. Deleting the library block affects Boards referencing it,
where it may appear unavailable.

## Storage and implementation

Custom blocks are saved on the Lintaya server, not as independent .md or .html
files. The editor is app/block-builder.jsx, the catalog app/block-catalog.jsx,
and the API server/routes/custom-blocks.js. Board editing lives in
app/module-builder.jsx.
