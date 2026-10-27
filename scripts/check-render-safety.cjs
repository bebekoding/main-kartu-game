const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => m[2].trim())
    .map(m => ({code:m[2], ast:acorn.parse(m[2], {
      ecmaVersion:'latest', sourceType:m[1].includes('module') ? 'module' : 'script',
      locations:true,
    })}));
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function check(html) {
  const failures = [];
  for (const {ast} of scripts(html)) walk(ast, node => {
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
        ['innerHTML','outerHTML'].includes(node.left.computed ? node.left.property.value : node.left.property.name)) {
      failures.push('Direct HTML assignment at script line '+node.loc.start.line);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
        ['insertAdjacentHTML','write','writeln'].includes(node.callee.property.name)) {
      failures.push('Unfiltered HTML API at script line '+node.loc.start.line);
    }
  });
  return failures;
}
if (require.main === module) {
  const failures = check(fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8'));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode=1; }
  else console.log('All inline scripts parse; no unfiltered HTML writes.');
}
module.exports = {scripts, check};
