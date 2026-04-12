/**
 * Same filename in different folders (read-only tree analysis).
 * @param {Array<{ name: string; type: string; children?: unknown }>} tree
 * @returns {Array<{ name: string; count: number }>}
 */
function findDuplicates(tree) {
  const counts = {};

  function scan(nodes) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((n) => {
      if (!n || typeof n.name !== 'string') return;
      if (n.type === 'file') {
        counts[n.name] = (counts[n.name] || 0) + 1;
      }
      if (n.children) scan(n.children);
    });
  }

  scan(tree);

  return Object.entries(counts)
    .filter(([, c]) => c > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

module.exports = { findDuplicates };
