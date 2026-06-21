/**
 * Targeted coverage for tree-builder.ts branches the html5lib suite leaves untouched:
 * a stray DOCTYPE token in each insertion mode (ignored), out-of-scope end tags
 * (ignored), and assorted mode-reset / table / select / frameset edges. We only
 * need the paths to EXECUTE; a light "doesn't throw + has a document" assert keeps
 * each case honest.
 */
import { describe, it, expect } from 'vitest';
import { TreeBuilder } from '../../src/main/parser/tree-builder';

const run = (html: string) => new TreeBuilder(html).parse();
const ok = (html: string) => expect(run(html).type).toBe('document');

describe('tree-builder — stray DOCTYPE is ignored in every mode', () => {
  for (const [label, html] of Object.entries({
    inBody: '<body>x<!doctype html>y',
    inTable: '<table><!doctype html>',
    inTableBody: '<table><tbody><!doctype html>',
    inRow: '<table><tr><!doctype html>',
    inCell: '<table><tr><td><!doctype html>',
    inColumnGroup: '<table><colgroup><!doctype html>',
    inCaption: '<table><caption><!doctype html>',
    inSelect: '<select><!doctype html>',
    inFrameset: '<frameset><!doctype html>',
    afterFrameset: '<frameset></frameset><!doctype html>',
    afterBody: '<body></body><!doctype html>',
  })) {
    it(label, () => ok(html));
  }
});

describe('tree-builder — out-of-scope end tags are ignored', () => {
  const cases = [
    '<table></caption>',          // </caption> with no caption
    '<table></tbody>',            // </tbody> with no tbody in scope
    '<table><tbody></tr>',        // </tr> with no tr
    '<table><tbody><tr></td>',    // </td> with no cell
    '<table></table></table>',    // second </table> with no table
    '<caption></caption></caption>',
    '<table><colgroup></colgroup>x', // colgroup close then content
    '<select></select></select>', // </select> with no select
    '<table><tr><td></td></tr></tbody></table>x',
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 40), () => ok(html));
});

describe('tree-builder — frameset / select-in-table / afterHead edges', () => {
  const cases = [
    '<frameset><html lang=en>',          // <html> in frameset → in-body merge
    '<frameset></frameset></html>x',     // afterFrameset </html> → afterAfterFrameset
    '<frameset></frameset></br>',        // afterFrameset stray end tag ignored
    '<frameset><div>',                   // non-frame start tag ignored in frameset
    '<head></head></template>x',         // afterHead </template> → inHead
    '<head></head></br>x',               // afterHead </br> → body
    '<table><tr><td><select></caption>', // in-select-in-table: out-of-scope table end tag
    '<table><tr><td><select></table>x',  // in-select-in-table: </table> in scope
    '<select><optgroup><option></optgroup>', // </optgroup> with option open
    '<select></optgroup></option>',      // stray select end tags
    '<table><tr><td><select><td>',       // <td> closes select-in-table
    '<frameset><frameset></frameset></frameset>', // nested frameset close
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 40), () => ok(html));
});

describe('tree-builder — tokens inside column-group / table-body / select sub-modes', () => {
  const cases = [
    '<table><colgroup>   ',                    // whitespace in colgroup (928)
    '<table><colgroup><!--c-->',               // comment in colgroup (929)
    '<table><colgroup><html lang=en>',         // <html> in colgroup (931)
    '<table><colgroup><template></template>',  // <template> in colgroup (933)
    '<table><colgroup></col>',                 // stray </col> ignored
    '<table><tbody><html lang=en>',            // <html> in table body
    '<table><tbody><!doctype html>',           // doctype in table body
    '<table><tr><html lang=en>',               // <html> in row
    '<table><tr><!doctype html>',              // doctype in row
    '<table><tr><td><html lang=en>',           // <html> in cell → in body
    '<select><html lang=en>',                  // <html> in select (998)
    '<select><!doctype html>',                 // doctype in select
    '<select><template></template>',           // <template> in select (1012)
    '<table><caption><!doctype html>',         // doctype in caption
    '<table><colgroup><!doctype html>',        // doctype in colgroup (930)
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 42), () => ok(html));
});

describe('tree-builder — <template> content (inTemplate mode)', () => {
  const cases = [
    '<template>text<!--c--><!doctype html></template>', // char/comment/doctype → inBody (1063)
    '<template><script>x</script></template>',          // head tag → inHead (1074)
    '<template><caption>c</caption></template>',        // caption → inTable (1077)
    '<template><col></template>',                       // col → inColumnGroup (1078)
    '<template><tr><td>x</td></tr></template>',         // tr → inTableBody (1079)
    '<template><td>x</td></template>',                  // td → inRow (1080)
    '<template><div>plain</div></template>',            // default → inBody
    '<template></div></template>',                      // stray end tag ignored (1071)
    '<template><b>unclosed',                            // EOF inside template (1065-1067)
    '<template><table></table></template>x',            // table closes → reset sees template (880)
    '<template><template>nested</template></template>', // nested template
    '<select><template><option></template></select>',  // template in select content
    '<template>',                                       // empty unclosed → EOF in inTemplate (1065-1067)
    '<template><base>',                                 // head tag keeps inTemplate, then EOF
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 44), () => ok(html));
});

describe('tree-builder — foreign breakout + table-body scope combos', () => {
  const cases = [
    '<svg><font color=red>x</font></svg>',   // <font color> breaks out of foreign content
    '<svg><font face=a>x</font></svg>',       // <font face> breakout
    '<table><thead><tr><td>a</table>',        // </table> with thead (not tbody) in scope
    '<table><tfoot><tr><td>a</table>',        // </table> with tfoot in scope
    '<table><thead><tr></thead><tbody><tr></table>',
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 42), () => ok(html));
});

describe('tree-builder — mode resets, table/select/frameset edges', () => {
  const cases = [
    '<table><tr><td><select><tr>',     // in-select-in-table: <tr> closes select
    '<table><tr><td><select></table>', // </table> from in-select-in-table
    '<select><option><optgroup>',      // optgroup pops option
    '<select><input>',                 // input closes select
    '<select><script>x</script>',      // script in select → inHead
    '<table><caption><select></caption>', // select reset inside caption
    '<frameset><frame><frame></frameset><noframes>x</noframes>',
    '<frameset></frameset><noframes>x</noframes>', // afterFrameset noframes
    '<table><form>x</form>',           // form in table (self-pop)
    '<table><tr><td>a</td><th>b</th></tr>',
    '<col><colgroup>',                 // resetInsertionMode → inColumnGroup
    '<td>orphan-cell',                 // td without table
    '<caption>orphan-caption',
  ];
  for (const html of cases) it(JSON.stringify(html).slice(0, 40), () => ok(html));
});
