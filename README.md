# All Things BRIDGE web reader

Developed with OpenAI Codex

Original article by Kirsche 🥥 🧁. [Read the original on X](https://x.com/KirscheVerstahl/status/2037697218132451615).

This reader was designed to drop into an existing website. The standalone theme is intentionally neutral so the reader can take on the host site's visual identity. Its styles are scoped to `.br-reader`. The embedded reader inherits the host's font family and text color by default, uses browser colors for surfaces and links, and supplies its own layout, spacing, and type sizes. You can set theme variables to match the rest of the site.

## Preview locally

Open `index.html` directly to read the article and navigate its sections. For the full experience, including media embeds that require an HTTP referrer, start the local preview with Node.js.

```sh
node preview.mjs
```

Visit [the local reader](http://localhost:4173/). The optional first argument sets another port. To check the plain HTML experience, run `node preview.mjs 4174 --no-js`.

## Add the reader to another site

1. Copy the markup between `<!-- Begin article reader -->` and `<!-- End article reader -->` in `index.html` into the host page. Use one reader per page so section IDs stay unique. The `br-preview-page` body class supplies the standalone demo palette and belongs on the demo page only.
2. Copy `reader.css`, the three JavaScript files, and the entire `media/` directory into a static assets folder. If the host page is in a different directory, update the article's image URLs to point to that folder. Keep `media/previews/` under the same directory as `reader.js` so the screenshot paths resolve.
3. Load the stylesheet and the deferred scripts in the order below. Replace `/bridge-reader/` with your own assets path.

```html
<link rel="stylesheet" href="/bridge-reader/reader.css">
<script defer src="/bridge-reader/preview-metadata.js"></script>
<script defer src="/bridge-reader/captured-page-shots.js"></script>
<script defer src="/bridge-reader/reader.js"></script>
```

### Match the host site's visuals

Set these CSS custom properties on `.br-reader` in a stylesheet loaded after `reader.css`, or supply inheritable theme values on a parent. For the standalone demo, set its accent and surface on `.br-preview-page .br-reader`.

```css
.br-reader {
  --br-font: var(--site-body-font, inherit);
  --br-heading-font: var(--site-heading-font, inherit);
  --br-text: var(--site-text, inherit);
  --br-surface: var(--site-card, Canvas);
  --br-accent: var(--site-link, LinkText);
  --br-sticky-top: var(--site-header-height, 0px);
}
```

| Tweak | Variables and selectors |
| --- | --- |
| Fonts and reading width | `--br-font`, `--br-heading-font`, `--br-body-size`, `--br-reading-width`, `--br-collapsed-reading-width` |
| Colors | `--br-text`, `--br-muted`, `--br-surface`, `--br-border`, `--br-subtle`, `--br-accent`, `--br-active` |
| Sticky position | `--br-sticky-top` and `--br-sticky-bottom` leave room for fixed headers and footers |
| Shape and spacing | Override the `.br-index`, `.br-timeline`, `.br-preview-card`, and `.br-dialog` rules in your host stylesheet. For the standalone project, edit the corresponding rules in `reader.css`. |

Use the host's `color-scheme` to set the light or dark appearance of browser colors and the supported X embed theme.

If the host sets a Content Security Policy, allow scripts from `https://platform.twitter.com` and `https://www.youtube.com`, and frames from `https://platform.twitter.com` and `https://www.youtube-nocookie.com`. Two verified sites offer **View page here** in their previews. Allow `https://www.bridgethegap.co` and `https://dougmelville.com` in `frame-src` to enable those. The original destination is available in a new tab even if an embed or preview is unavailable.

## Navigate the article

- **Contents** is the sticky sidebar. Its titles and dates preserve the order of the original article. Select its header to collapse it into a narrow rail or open it again. On phones, it starts collapsed and closes after you select a section.
- **Timeline** sticks to the bottom and lists dates in chronological order, with each section title below its date. Swipe or scroll it horizontally. Select its header to collapse it to one row or expand it. It starts collapsed on phones.
- Both bars highlight the section you are reading where it appears in their list. The article, its images, and the section links live in the HTML. With JavaScript enabled, **Copy section link** provides a shareable link to each section.

## Link previews

Expanded previews show available link metadata, screenshot thumbnails, and supported X and YouTube embeds. Thumbnails load lazily and live embeds load as you approach them. Videos wait for you to press Play. You can close a preview individually, enlarge a screenshot, or open the original link in a new tab.

For links with only text previews, accessible public pages were captured in the in-app browser and the first page of each linked PDF was rendered with Poppler's `pdftoppm`. These snapshots are bundled in `media/previews/`. To add or refresh a capture, save the image there and add the exact article URL, image path, width, and height to `captured-page-shots.js`. The reader matches captures to the original links. Pages that could not be captured, including archive links that failed to load, still show the available text preview.

If previews make the page feel heavy on your device, choose **Use light previews** near the byline. In that mode, cards and embeds load only when you select a preview. Choose **Expand previews** to switch back. The reader remembers the choice in the current browser when storage is available. It can suggest light previews when an embed loads slowly and start in light mode if the browser reports data saving or a very slow connection.
