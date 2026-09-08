// Provider-neutral pagination primitive. Connectors keep control of their
// provider-specific cursor/page shape while sharing the safety contract:
// ordered items, a hard page bound, and explicit truncation when another page
// exists beyond that bound.
async function collectPages({ fetchPage, getItems, getNext, initialCursor = null, maxPages = 10 }) {
  if (typeof fetchPage !== "function" || typeof getItems !== "function" || typeof getNext !== "function") {
    throw new TypeError("collectPages requires fetchPage, getItems and getNext");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new TypeError("maxPages must be a positive integer");

  const items = [];
  let cursor = initialCursor;
  let pageCount = 0;
  let hasMore = true;
  while (hasMore && pageCount < maxPages) {
    const page = await fetchPage(cursor, pageCount);
    const batch = getItems(page, pageCount);
    if (!Array.isArray(batch)) throw new TypeError("getItems must return an array");
    items.push(...batch);
    pageCount += 1;
    const next = getNext(page, batch, cursor, pageCount);
    hasMore = next !== null && next !== undefined && next !== false;
    cursor = next;
  }
  return { items, pageCount, truncated: hasMore };
}

module.exports = { collectPages };
