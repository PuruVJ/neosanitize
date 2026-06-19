import { describe, it, expect, vi } from 'vitest';
import sanitizeHtml from '../src/index';

describe('sanitizeHtml', () => {
  it('should escape self closing tags', () => {
    expect(sanitizeHtml('before <img src="test.png" /> after', {
      disallowedTagsMode: 'escape',
      allowedTags: [],
      allowedAttributes: false
    })).toBe('before &lt;img src="test.png" /&gt; after');
  });
  it('should handle numbers as strings', () => {
    expect(sanitizeHtml(5, {
      allowedTags: [ 'b', 'em', 'i', 's', 'small', 'strong', 'sub', 'sup', 'time', 'u' ],
      allowedAttributes: {},
      disallowedTagsMode: 'recursiveEscape'
    })).toBe('5');
  });
  it('should pass through simple, well-formed markup', function() {
    expect(sanitizeHtml('<div><p>Hello <b>there</b></p></div>')).toBe('<div><p>Hello <b>there</b></p></div>');
  });
  it('should not pass through any text outside html tag boundary since html tag is found and option is ON', function() {
    expect(sanitizeHtml('Text before html tag<html><div><p>Hello <b>there</b></p></div></html>Text after html tag!P�X��[<p>paragraph after closing html</p>', {
      enforceHtmlBoundary: true
    }
    )).toBe('<div><p>Hello <b>there</b></p></div>');
  });
  it('should pass through text outside html tag boundary since option is OFF', function() {
    expect(sanitizeHtml('Text before html tag<html><div><p>Hello <b>there</b></p></div></html>Text after html tag!P�X��[<p>paragraph after closing html</p>', {
      enforceHtmlBoundary: false
    }
    )).toBe('Text before html tag<div><p>Hello <b>there</b></p></div>Text after html tag!P�X��[<p>paragraph after closing html</p>');
  });
  it('should pass through text outside html tag boundary since option is ON but html tag is not found', function() {
    expect(sanitizeHtml('Text before div tag<div><p>Hello <b>there</b></p></div>Text after div tag!P�X��[<p>paragraph after closing div</p>', {
      enforceHtmlBoundary: true
    }
    )).toBe('Text before div tag<div><p>Hello <b>there</b></p></div>Text after div tag!P�X��[<p>paragraph after closing div</p>');
  });
  it('should pass through all markup if allowedTags and allowedAttributes are set to false', function() {
    expect(sanitizeHtml('<div><wiggly worms="ewww">hello</wiggly></div>', {
      allowedTags: false,
      allowedAttributes: false
    })).toBe('<div><wiggly worms="ewww">hello</wiggly></div>');
  });
  it('should not pass through any markup if allowedTags is set to undefined (falsy but not exactly false)', function() {
    expect(sanitizeHtml('<div><wiggly worms="ewww">hello</wiggly></div>', {
      allowedTags: undefined
    })).toBe('hello');
  });
  it('should not pass through any markup if allowedTags is set to 0 (falsy but not exactly false)', function() {
    expect(sanitizeHtml('<div><wiggly worms="ewww">hello</wiggly></div>', {
      allowedTags: 0
    })).toBe('hello');
  });
  it('should not pass through any markup if allowedTags is set to null (falsy but not exactly false)', function() {
    expect(sanitizeHtml('<div><wiggly worms="ewww">hello</wiggly></div>', {
      allowedTags: null
    })).toBe('hello');
  });
  it('should not pass through any markup if allowedTags is set to empty string (falsy but not exactly false)', function() {
    expect(sanitizeHtml('<div><wiggly worms="ewww">hello</wiggly></div>', {
      allowedTags: ''
    })).toBe('hello');
  });
  it('should respect text nodes at top level', function() {
    expect(sanitizeHtml('Blah blah blah<p>Whee!</p>')).toBe('Blah blah blah<p>Whee!</p>');
  });
  it('should return an empty string when input is explicit "undefined"', function() {
    expect(sanitizeHtml(undefined)).toBe('');
  });
  it('should return an empty string when input is explicit "null"', function() {
    expect(sanitizeHtml(null)).toBe('');
  });
  it('should return an empty string when input is not provided', function() {
    expect(sanitizeHtml()).toBe('');
  });
  it('should return an empty string when input is an empty string', function() {
    expect(sanitizeHtml('')).toBe('');
  });
  it('should reject markup not allowlisted without destroying its text', function() {
    expect(sanitizeHtml('<div><wiggly>Hello</wiggly></div>')).toBe('<div>Hello</div>');
  });
  it('should escape markup not allowlisted', function() {
    expect(sanitizeHtml('<div><wiggly>Hello</wiggly></div>', { disallowedTagsMode: 'escape' })).toBe('<div>&lt;wiggly&gt;Hello&lt;/wiggly&gt;</div>');
  });
  it('should accept a custom list of allowed tags', function() {
    expect(sanitizeHtml('<blue><red><green>Cheese</green></red></blue>', { allowedTags: [ 'blue', 'green' ] })).toBe('<blue><green>Cheese</green></blue>');
  });
  it('should reject attributes not allowlisted', function() {
    expect(sanitizeHtml('<a href="foo.html" whizbang="whangle">foo</a>')).toBe('<a href="foo.html">foo</a>');
  });
  it('should accept a custom list of allowed attributes per element', function() {
    expect(sanitizeHtml('<a href="foo.html" whizbang="whangle">foo</a>', { allowedAttributes: { a: [ 'href', 'whizbang' ] } })).toBe('<a href="foo.html" whizbang="whangle">foo</a>');
  });
  it('should clean up unclosed img tags and p tags', function() {
    expect(sanitizeHtml('<img src="foo.jpg"><p>Whee<p>Again<p>Wow<b>cool</b>', {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ])
    })).toBe('<img src="foo.jpg" /><p>Whee</p><p>Again</p><p>Wow<b>cool</b></p>');
  });
  it('should reject hrefs that are not relative, ftp, http, https or mailto', function() {
    expect(sanitizeHtml('<a href="http://google.com">google</a><a href="https://google.com">https google</a><a href="ftp://example.com">ftp</a><a href="mailto:test@test.com">mailto</a><a href="/relative.html">relative</a><a href="javascript:alert(0)">javascript</a>')).toBe('<a href="http://google.com">google</a><a href="https://google.com">https google</a><a href="ftp://example.com">ftp</a><a href="mailto:test@test.com">mailto</a><a href="/relative.html">relative</a><a>javascript</a>');
  });
  it('should cope identically with capitalized attributes and tags and should tolerate capitalized schemes', function() {
    expect(sanitizeHtml('<A HREF="http://google.com">google</a><a href="HTTPS://google.com">https google</a><a href="ftp://example.com">ftp</a><a href="mailto:test@test.com">mailto</a><a href="/relative.html">relative</a><a href="javascript:alert(0)">javascript</a>')).toBe('<a href="http://google.com">google</a><a href="HTTPS://google.com">https google</a><a href="ftp://example.com">ftp</a><a href="mailto:test@test.com">mailto</a><a href="/relative.html">relative</a><a>javascript</a>');
  });
  it('should drop the content of script elements', function() {
    expect(sanitizeHtml('<script>alert("ruhroh!");</script><p>Paragraph</p>')).toBe('<p>Paragraph</p>');
  });
  it('should drop the content of style elements', function() {
    expect(sanitizeHtml('<style>.foo { color: blue; }</style><p>Paragraph</p>')).toBe('<p>Paragraph</p>');
  });
  it('should drop the content of textarea elements', function() {
    expect(sanitizeHtml('<textarea>Nifty</textarea><p>Paragraph</p>')).toBe('<p>Paragraph</p>');
  });
  it('should drop the content of option elements', function() {
    expect(sanitizeHtml('<select><option>one</option><option>two</option></select><p>Paragraph</p>')).toBe('<p>Paragraph</p>');
  });
  it('should drop the content of textarea elements but keep the closing parent tag, when nested', function() {
    expect(sanitizeHtml('<p>Paragraph<textarea>Nifty</textarea></p>')).toBe('<p>Paragraph</p>');
  });
  it('should drop the content of disallowed xmp elements rather than re-emit it as live markup', function() {
    // Regression test for GHSA-rpr9-rxv7-x643: htmlparser2 parses the contents
    // of <xmp> as raw text, so without xmp in nonTextTags the inner markup
    // would be re-emitted unescaped and become live HTML.
    expect(sanitizeHtml('<xmp><script>alert(1)</script></xmp>')).toBe('');
    expect(sanitizeHtml('<xmp><img src=x onerror=alert(1)></xmp>')).toBe('');
    expect(sanitizeHtml('<xmp><svg><script>alert(1)</script></svg></xmp>')).toBe('');
    expect(sanitizeHtml('before<xmp><script>alert(1)</script></xmp>after')).toBe('beforeafter');
  });
  it('should retain the content of fibble elements by default', function() {
    expect(sanitizeHtml('<fibble>Nifty</fibble><p>Paragraph</p>')).toBe('Nifty<p>Paragraph</p>');
  });
  it('should discard the content of fibble elements if specified for nonTextTags', function() {
    expect(sanitizeHtml('<fibble>Nifty</fibble><p>Paragraph</p>', { nonTextTags: [ 'fibble' ] })).toBe('<p>Paragraph</p>');
  });
  it('should retain allowed tags within a fibble element if fibble is not specified for nonTextTags', function() {
    expect(sanitizeHtml('<fibble>Ni<em>f</em>ty</fibble><p>Paragraph</p>', {})).toBe('Ni<em>f</em>ty<p>Paragraph</p>');
  });
  it('should discard allowed tags within a fibble element if fibble is specified for nonTextTags', function() {
    expect(sanitizeHtml('<fibble>Ni<em>f</em>ty</fibble><p>Paragraph</p>', { nonTextTags: [ 'fibble' ] })).toBe('<p>Paragraph</p>');
  });
  it('should preserve textarea content if textareas are allowed', function() {
    expect(sanitizeHtml('<textarea>Nifty</textarea><p>Paragraph</p>', {
      allowedTags: [ 'textarea', 'p' ]
    })).toBe('<textarea>Nifty</textarea><p>Paragraph</p>');
  });
  it('should preserve entities as such', function() {
    expect(sanitizeHtml('<a name="&lt;silly&gt;">&lt;Kapow!&gt;</a>')).toBe('<a name="&lt;silly&gt;">&lt;Kapow!&gt;</a>');
  });
  it('should dump closing tags which do not have any opening tags.', function() {
    expect(sanitizeHtml('<b><div/', {
      allowedTags: [ 'b' ]
    })).toBe('<b>/</b>');

    expect(sanitizeHtml('<b><b<<div/', {
      allowedTags: [ 'b' ]
    })).toBe('<b>/</b>');
  });
  it('should tolerate not closed p tags', function() {
    expect(sanitizeHtml('<div><p>inner text 1<p>inner text 2<p>inner text 3</div>')).toBe('<div><p>inner text 1</p><p>inner text 2</p><p>inner text 3</p></div>');
  });
  it('should escape not closed p tags, if not in allowedTags array', function() {
    expect(sanitizeHtml('<div><p>inner text 1<p>inner text 2<p>inner text 3</div>', {
      allowedTags: [ 'div' ]
    })).toBe('<div>inner text 1inner text 2inner text 3</div>');
  });
  it('should dump comments', function() {
    expect(sanitizeHtml('<p><!-- Blah blah -->Whee</p>')).toBe('<p>Whee</p>');
  });
  it('should dump a sneaky encoded javascript url', function() {
    expect(sanitizeHtml('<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;">Hax</a>')).toBe('<a>Hax</a>');
  });
  it('should dump an uppercase javascript url', function() {
    expect(sanitizeHtml('<a href="JAVASCRIPT:alert(\'foo\')">Hax</a>')).toBe('<a>Hax</a>');
  });
  it('should dump a javascript URL with a comment in the middle (probably only respected by browsers in XML data islands, but just in case someone enables those)', function() {
    expect(sanitizeHtml('<a href="java<!-- -->script:alert(\'foo\')">Hax</a>')).toBe('<a>Hax</a>');
  });
  it('should not mess up a hashcode with a : in it', function() {
    expect(sanitizeHtml('<a href="awesome.html#this:stuff">Hi</a>')).toBe('<a href="awesome.html#this:stuff">Hi</a>');
  });
  it('should dump character codes 1-32 before testing scheme', function() {
    expect(sanitizeHtml('<a href="java\0&#14;\t\r\n script:alert(\'foo\')">Hax</a>')).toBe('<a>Hax</a>');
  });
  it('should dump character codes 1-32 even when escaped with padding rather than trailing ;', function() {
    // htmlparser2 10.x correctly decodes zero-padded numeric entities.
    // &#0000001 decodes to U+0001, which is stripped as a control char,
    // revealing the javascript: scheme
    expect(sanitizeHtml('<a href="java&#0000001script:alert(\'foo\')">Hax</a>')).toBe('<a>Hax</a>');
    // &#0000000 decodes to U+FFFD (replacement character per HTML spec),
    // which is not a control char, so the URL is preserved safely since
    // browsers don't interpret java�script: as javascript:
    expect(sanitizeHtml('<a href="java&#0000000script:alert(\'foo\')">Hax</a>')).toBe('<a href="java\uFFFDscript:alert(\'foo\')">Hax</a>');
  });
  it('should still like nice schemes', function() {
    expect(sanitizeHtml('<a href="http://google.com/">Hi</a>')).toBe('<a href="http://google.com/">Hi</a>');
  });
  it('should still like nice relative URLs', function() {
    expect(sanitizeHtml('<a href="hello.html">Hi</a>')).toBe('<a href="hello.html">Hi</a>');
  });
  it('should replace ol to ul', function() {
    expect(sanitizeHtml('<ol><li>Hello world</li></ol>', { transformTags: { ol: 'ul' } })).toBe('<ul><li>Hello world</li></ul>');
  });
  it('should replace ol to ul and add class attribute with foo value', function() {
    expect(sanitizeHtml('<ol><li>Hello world</li></ol>', {
      transformTags: { ol: sanitizeHtml.simpleTransform('ul', { class: 'foo' }) },
      allowedAttributes: { ul: [ 'class' ] }
    })).toBe('<ul class="foo"><li>Hello world</li></ul>');
  });
  it('should replace ol to ul, left attributes foo and bar untouched, remove baz attribute and add class attributte with foo value', function() {
    expect(sanitizeHtml('<ol foo="foo" bar="bar" baz="baz"><li>Hello world</li></ol>', {
      transformTags: { ol: sanitizeHtml.simpleTransform('ul', { class: 'foo' }) },
      allowedAttributes: { ul: [ 'foo', 'bar', 'class' ] }
    })).toBe('<ul foo="foo" bar="bar" class="foo"><li>Hello world</li></ul>');
  });
  it('should replace ol to ul and replace all attributes to class attribute with foo value', function() {
    expect(sanitizeHtml('<ol foo="foo" bar="bar" baz="baz"><li>Hello world</li></ol>', {
      transformTags: { ol: sanitizeHtml.simpleTransform('ul', { class: 'foo' }, false) },
      allowedAttributes: { ul: [ 'foo', 'bar', 'class' ] }
    })).toBe('<ul class="foo"><li>Hello world</li></ul>');
  });
  it('should replace ol to ul and add attribute class with foo value and attribute bar with bar value', function() {
    expect(sanitizeHtml('<ol><li>Hello world</li></ol>', {
      transformTags: {
        ol: function(tagName, attribs) {
          attribs.class = 'foo';
          attribs.bar = 'bar';
          return {
            tagName: 'ul',
            attribs
          };
        }
      },
      allowedAttributes: { ul: [ 'bar', 'class' ] }
    })).toBe('<ul class="foo" bar="bar"><li>Hello world</li></ul>');
  });

  it('should replace text and attributes when they are changed by transforming function', function () {
    expect(sanitizeHtml('<a href="http://somelink">some text</a>', {
      transformTags: {
        a: function (tagName, attribs) {
          return {
            tagName,
            attribs,
            text: ''
          };
        }
      }
    })).toBe('<a href="http://somelink"></a>');
  });
  it('should replace text and attributes when they are changed by transforming function and textFilter is set', function () {
    expect(sanitizeHtml('<a href="http://somelink">some text</a>', {
      transformTags: {
        a: function (tagName, attribs) {
          return {
            tagName,
            attribs,
            text: 'some text need"to<be>filtered'
          };
        }
      },
      textFilter: function (text, tagName) {
        return text.replace(/\s/g, '_');
      }
    })).toBe('<a href="http://somelink">some_text_need"to&lt;be&gt;filtered</a>');
  });

  it('should replace text and attributes when they are changed by transforming function and textFilter is not set', function () {
    expect(sanitizeHtml('<a href="http://somelink">some text</a>', {
      transformTags: {
        a: function (tagName, attribs) {
          return {
            tagName,
            attribs,
            text: 'some good text'
          };
        }
      }
    })).toBe('<a href="http://somelink">some good text</a>');
  });

  it('should preserve trailing text when replacing the tagName and adding new text via transforming function', function () {
    expect(sanitizeHtml('<p>text before <br> text after</p>', {
      transformTags: {
        br: function (_tagName, _attribs) {
          return {
            tagName: 'span',
            text: ' '
          };
        }
      }
    })).toBe('<p>text before <span> </span> text after</p>');
  });

  it('should add new text when not initially set and replace attributes when they are changed by transforming function', function () {
    expect(sanitizeHtml('<a href="http://somelink"></a>', {
      transformTags: {
        a: function (tagName, attribs) {
          return {
            tagName,
            attribs,
            text: 'some new text'
          };
        }
      }
    })).toBe('<a href="http://somelink">some new text</a>');
  });

  it('should preserve text when initially set and replace attributes when they are changed by transforming function', function () {
    expect(sanitizeHtml('<a href="http://somelink">some initial text</a>', {
      transformTags: {
        a: function (tagName, attribs) {
          return {
            tagName,
            attribs
          };
        }
      }
    })).toBe('<a href="http://somelink">some initial text</a>');
  });

  it('should skip an empty link', function() {
    expect(sanitizeHtml('<p>This is <a href="http://www.linux.org"></a><br/>Linux</p>', {
        exclusiveFilter: function (frame) {
          return frame.tag === 'a' && !frame.text.trim();
        }
      })).toBe('<p>This is <br />Linux</p>');
  });

  it('Should expose a node\'s inner text and inner HTML to the filter', function() {
    expect(sanitizeHtml('<p>12<a href="http://www.linux.org"><br/>3<br></a><audio>4</audio></p>', {
        exclusiveFilter: function(frame) {
          if (frame.tag === 'p') {
            expect(frame.text).toBe('124');
          } else if (frame.tag === 'a') {
            expect(frame.text).toBe('3');
            return true;
          } else if (frame.tag === 'br') {
            expect(frame.text).toBe('');
          } else {
            expect.fail('expected ' + 'p, a, br' + ', got ' + frame.tag);
          }
          return false;
        }
      })).toBe('<p>124</p>');
  });

  it('Should collapse nested empty elements', function() {
    expect(sanitizeHtml('<p><a href="http://www.linux.org"><br/></a></p>', {
        exclusiveFilter: function(frame) {
          return (frame.tag === 'a' || frame.tag === 'p') && !frame.text.trim();
        }
      })).toBe('');
  });

  it('Should find child media elements that are in allowedTags', function() {
    const markup = '<a href="http://www.linux.org"><img /><video></video></a>';
    const sansVideo = '<a href="http://www.linux.org"><img /></a>';
    const sanitizedMarkup = sanitizeHtml(markup, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
      exclusiveFilter: function(frame) {
        if (frame.tag === 'a') {

          expect(frame.mediaChildren.length === 1).toBeTruthy();
        }

        return (frame.tag === 'a') && !frame.text.trim() && !frame.mediaChildren.length;
      }
    });

    expect(sanitizedMarkup).toBe(sansVideo);
  });

  it('Exclusive filter should not affect elements which do not match the filter condition', function () {
    expect(sanitizeHtml('I love <a href="www.linux.org" target="_hplink">Linux</a> OS',
        {
          exclusiveFilter: function (frame) {
            return (frame.tag === 'a') && !frame.text.trim();
          }
        })).toBe('I love <a href="www.linux.org" target="_hplink">Linux</a> OS');
  });

  it('Exclusive filter should not run for discarded tags', function () {
    expect(sanitizeHtml('this tag is <wiggly>discarded</wiggly>',
        {
          exclusiveFilter: function () {
            throw Error('this should not run');
          }
        })).toBe('this tag is discarded');
  });

  it('should keep inner text when exclusiveFilter returns "excludeTag"', function() {
    expect(sanitizeHtml('<p>These links <a href="javascript:alert(123)">hack</a> <a href="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">more hack</a> have disallowed href protocols</p>', {
        exclusiveFilter: function (frame) {
          return frame.tag === 'a' && !frame.attribs.src ? 'excludeTag' : false;
        }
      })).toBe('<p>These links hack more hack have disallowed href protocols</p>');
  });

  it('should keep inner tags when exclusiveFilter returns "excludeTag"', function() {
    expect(sanitizeHtml('This div is bad <div class="bad">but its <strong>content</strong><p>should be kept <em>as-is</em></p></div>.', {
        exclusiveFilter: function (frame) {
          return frame.tag === 'div' && frame.attribs.class && /\bbad\b/.test(frame.attribs.class) ? 'excludeTag' : false;
        }
      })).toBe('This div is bad but its <strong>content</strong><p>should be kept <em>as-is</em></p>.');
  });

  it('should work with escaped tags when exclusiveFilter returns "excludeTag"', function () {
    expect(sanitizeHtml('<strong>hello</strong> <wiggly>there. <em>General Kenobi</em></wiggly>!', {
        disallowedTagsMode: 'escape',
        exclusiveFilter: function (frame) {
          return frame.tag === 'wiggly' ? 'excludeTag' : false;
        }
      })).toBe('<strong>hello</strong> there. <em>General Kenobi</em>!');
  });

  it('should disallow data URLs with default allowedSchemes', function() {
    expect(sanitizeHtml(
        // teeny-tiny valid transparent GIF in a data URL
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />',
        {
          allowedTags: [ 'img' ]
        }
      )).toBe('<img />');
  });
  it('should allow data URLs with custom allowedSchemes', function() {
    expect(sanitizeHtml(
        // teeny-tiny valid transparent GIF in a data URL
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />',
        {
          allowedTags: [ 'img', 'p' ],
          allowedSchemes: [ 'data', 'http' ]
        }
      )).toBe('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />');
  });
  it('should allow specific classes when allowlisted with allowedClasses for a single tag', function() {
    expect(sanitizeHtml(
        '<p class="nifty simple dippy">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            p: [ 'nifty' ]
          }
        }
      )).toBe('<p class="nifty">whee</p>');
  });
  it('should allow specific classes when allowlisted with allowedClasses for all tags', function() {
    expect(sanitizeHtml(
        '<p class="nifty simple dippy">whee</p><div class="dippy nifty simple"></div>',
        {
          allowedTags: [ 'p', 'div' ],
          allowedClasses: {
            '*': [ 'nifty' ]
          }
        }
      )).toBe('<p class="nifty">whee</p><div class="nifty"></div>');
  });
  it('should allow all classes that are allowlisted for a single tag or all tags', function() {
    expect(sanitizeHtml(
        '<p class="nifty simple dippy">whee</p><div class="simple dippy nifty"></div>',
        {
          allowedTags: [ 'p', 'div' ],
          allowedClasses: {
            '*': [ 'simple' ],
            p: [ 'nifty' ],
            div: [ 'dippy' ]
          }
        }
      )).toBe('<p class="nifty simple">whee</p><div class="simple dippy"></div>');
  });
  it('should allow classes that match wildcards for a single tag or all tags', function() {
    expect(sanitizeHtml(
        '<p class="nifty- nifty-a simple dippy dippy-a-simple">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            '*': [ 'dippy-*-simple' ],
            p: [ 'nifty-*' ]
          }
        }
      )).toBe('<p class="nifty- nifty-a dippy-a-simple">whee</p>');
  });
  it('should allow all classes if `allowedClasses` contains a single `*`', function() {
    expect(sanitizeHtml(
        '<p class="nifty simple dippy">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            '*': [ '*' ]
          }
        }
      )).toBe('<p class="nifty simple dippy">whee</p>');
  });
  it('should allow all classes for a single tag if `allowedClasses` for the tag is false', function() {
    expect(sanitizeHtml(
        '<p class="nifty simple dippy">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            p: false
          }
        }
      )).toBe('<p class="nifty simple dippy">whee</p>');
  });
  it('should allow only classes that matches `allowedClasses` regex', function() {
    expect(sanitizeHtml(
        '<p class="nifty33 nifty2 dippy">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            p: [ /^nifty\d{2}$/, /^d\w{4}$/ ]
          }
        }
      )).toBe('<p class="nifty33 dippy">whee</p>');
  });
  it('should allow classes that match `allowedClasses` regex for all tags', function() {
    expect(sanitizeHtml(
        '<p class="nifty33 nifty2 dippy">whee</p>',
        {
          allowedClasses: {
            '*': [ /^nifty\d{2}$/, /^d\w{4}$/ ]
          }
        }
      )).toBe('<p class="nifty33 dippy">whee</p>');
  });
  it('should allow defining schemes on a per-tag basis', function() {
    expect(sanitizeHtml(
        // teeny-tiny valid transparent GIF in a data URL
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" /><a href="https://www.example.com"></a>',
        {
          allowedTags: [ 'img', 'a' ],
          allowedSchemes: [ 'http' ],
          allowedSchemesByTag: {
            img: [ 'data' ],
            a: [ 'https' ]
          }
        }
      )).toBe('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" /><a href="https://www.example.com"></a>');
    expect(sanitizeHtml(
        // teeny-tiny valid transparent GIF in a data URL
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" /><a href="https://www.example.com"></a>',
        {
          allowedTags: [ 'img', 'a' ],
          allowedSchemes: [ 'http' ],
          allowedSchemesByTag: {
            img: [],
            a: [ 'https' ]
          }
        }
      )).toBe('<img /><a href="https://www.example.com"></a>');
  });
  it('should not act weird when the class attribute is empty', function() {
    expect(sanitizeHtml(
        '<p class="">whee</p>',
        {
          allowedTags: [ 'p' ],
          allowedClasses: {
            p: [ 'nifty' ]
          }
        }
      )).toBe('<p>whee</p>');
  });
  it('should not crash on bad markup', function() {
    expect(sanitizeHtml(
        '<p a'
      )).toBe('');
  });
  it('should not allow a naked = sign followed by an unrelated attribute to result in one merged attribute with unescaped double quote marks', function() {
    expect(sanitizeHtml(
        '<IMG SRC= onmouseover="alert(\'XSS\');">',
        {
          allowedTags: [ 'img' ],
          allowedAttributes: {
            img: [ 'src' ]
          }
        }
      )).toBe(// This is weird but not dangerous. Without the &quot there
      // would probably be some way to make it come out as a
      // separate attribute
      '<img src="onmouseover=&quot;alert(\'XSS\');&quot;" />');
  });

  it('should deliver a warning if using vulnerable tags', function() {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const message = '\n\n⚠️ Your `allowedTags` option includes, `style`, which is inherently\nvulnerable to XSS attacks. Please remove it from `allowedTags`.\nOr, to disable this warning, add the `allowVulnerableTags` option\nand ensure you are accounting for this risk.\n\n';

    sanitizeHtml(
      '<style></style>',
      {
        allowedTags: [ 'style' ]
      }
    );

    expect(spy).toHaveBeenCalledWith(message);
    // Restore the spied-upon method
    /* eslint-disable-next-line no-console */
    spy.mockRestore();
  });

  it('should not deliver a warning if using the allowVulnerableTags option', function() {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    sanitizeHtml(
      '<style></style>',
      {
        allowVulnerableTags: true,
        allowedTags: [ 'style' ]
      }
    );

    expect(spy).not.toHaveBeenCalled();
    // Restore the spied-upon method
    /* eslint-disable-next-line no-console */
    spy.mockRestore();
  });

  it('should allow only approved attributes, but to any tags, if tag is declared as  "*"', function() {
    expect(sanitizeHtml(
        '<table bgcolor="1" align="left" notlisted="0"><img src="1.gif" align="center" alt="not listed too"/></table>',
        {
          allowedTags: [ 'table', 'img' ],
          allowedAttributes: {
            '*': [ 'bgcolor', 'align', 'src' ]
          }
        }
      )).toBe('<table bgcolor="1" align="left"><img src="1.gif" align="center" /></table>');
  });
  it('should not filter if exclusive filter does not match after transforming tags', function() {
    expect(sanitizeHtml(
        '<a href="test.html">test</a>',
        {
          allowedTags: [ 'a' ],
          allowedAttributes: { a: [ 'href', 'target' ] },
          transformTags: {
            a: function (tagName, attribs) {
              if (!attribs.href) {
                return false;
              }
              return {
                tagName,
                attribs: {
                  target: '_blank',
                  href: attribs.href
                }
              };
            }
          },
          exclusiveFilter: function(frame) {
            return frame.tag === 'a' && frame.text.trim() === 'blah';
          }
        }
      )).toBe('<a target="_blank" href="test.html">test</a>');
  });
  it('should filter if exclusive filter does match after transforming tags', function() {
    expect(sanitizeHtml(
        '<a href="test.html">blah</a>',
        {
          allowedTags: [ 'a' ],
          allowedAttributes: { a: [ 'href', 'target' ] },
          transformTags: {
            a: function (tagName, attribs) {
              if (!attribs.href) {
                return false;
              }
              return {
                tagName,
                attribs: {
                  target: '_blank',
                  href: attribs.href
                }
              };
            }
          },
          exclusiveFilter: function(frame) {
            return frame.tag === 'a' && frame.text.trim() === 'blah';
          }
        }
      )).toBe('');
  });
  it('should allow transform on all tags using \'*\'', function () {
    expect(sanitizeHtml(
        '<p>Text</p>',
        {
          allowedTags: [ 'p' ],
          allowedAttributes: { p: [ 'style' ] },
          transformTags: {
            '*': function (tagName, attribs) {
              return {
                tagName,
                attribs: {
                  style: 'text-align: center'
                }
              };
            }
          }
        }
      )).toBe('<p style="text-align:center">Text</p>');
  });
  it('should not be faked out by double <', function() {
    expect(sanitizeHtml('<<img src="javascript:evil"/>img src="javascript:evil"/>'
      )).toBe('&lt;img src="javascript:evil"/&gt;');
    expect(sanitizeHtml('<<a href="javascript:evil"/>a href="javascript:evil"/>'
      )).toBe('&lt;<a>a href="javascript:evil"/&gt;</a>');
  });
  it('should allow attributes to be specified as globs', function() {
    expect(sanitizeHtml('<a data-target="#test" data-foo="hello">click me</a>', {
        allowedTags: [ 'a' ],
        allowedAttributes: { a: [ 'data-*' ] }
      })).toBe('<a data-target="#test" data-foo="hello">click me</a>');
    expect(sanitizeHtml('<a data-target="#test" data-my-foo="hello">click me</a>', {
        allowedTags: [ 'a' ],
        allowedAttributes: { a: [ 'data-*-foo' ] }
      })).toBe('<a data-my-foo="hello">click me</a>');
  });
  it('should quote regex chars in attributes specified as globs', function() {
    expect(sanitizeHtml('<a data-b.c="#test" data-bcc="remove this">click me</a>', {
        allowedTags: [ 'a' ],
        allowedAttributes: { a: [ 'data-b.*' ] }
      })).toBe('<a data-b.c="#test">click me</a>');
  });
  it('should not escape inner content of script and style tags (when allowed)', function() {
    expect(sanitizeHtml('<div>"normal text"</div><script>"this is code"</script>', {
        allowedTags: [ 'script' ]
      })).toBe('"normal text"<script>"this is code"</script>');
    expect(sanitizeHtml('<div>"normal text"</div><style>body { background-image: url("image.test"); }</style>', {
        allowedTags: [ 'style' ]
      })).toBe('"normal text"<style>body { background-image: url("image.test"); }</style>');
  });
  it('should not unescape escapes found inside script tags', function() {
    expect(sanitizeHtml('<script>alert("&quot;This is cool but just ironically so I quoted it&quot;")</script>',
        {
          allowedTags: [ 'script' ]
        }
      )).toBe('<script>alert("&quot;This is cool but just ironically so I quoted it&quot;")</script>');
  });
  it('should process text nodes with provided function', function() {
    expect(sanitizeHtml('"normal text this should be removed"', {
        textFilter: function(text, tagName) {
          return text.replace(' this should be removed', '');
        }
      })).toBe('"normal text"');
  });
  it('should skip text nodes based on tagName', function() {
    expect(sanitizeHtml('<a>normal text this should be removed</a><b>normal text this should be removed</b>', {
        textFilter: function(text, tagName) {
          if (tagName === 'a') {
            return text;
          };
          return text.replace(' this should be removed', '');
        }
      })).toBe('<a>normal text this should be removed</a><b>normal text</b>');
  });
  it('should respect htmlparser2 options when passed in', function() {
    expect(sanitizeHtml('<Archer><Sterling>I am</Sterling></Archer>', {
        allowedTags: false,
        allowedAttributes: false
      })).toBe('<archer><sterling>I am</sterling></archer>');
    expect(sanitizeHtml('<Archer><Sterling>I am</Sterling></Archer>', {
        allowedTags: false,
        allowedAttributes: false,
        parser: {
          lowerCaseTags: false
        }
      })).toBe('<Archer><Sterling>I am</Sterling></Archer>');
  });
  it('should not crash due to tag names that are properties of the universal Object prototype', function() {
    expect(sanitizeHtml('!<__proto__>!')).toBe('!&lt;__proto__&gt;!');
  });
  it('should correctly maintain escaping when allowing a nonTextTags tag other than script or style', function() {
    expect(sanitizeHtml('!<textarea>&lt;/textarea&gt;&lt;svg/onload=prompt`xs`&gt;</textarea>!',
        { allowedTags: [ 'textarea' ] }
      )).toBe('!<textarea>&lt;/textarea&gt;&lt;svg/onload=prompt`xs`&gt;</textarea>!');
  });
  it('should not double-encode entities inside an allowed textarea element', function() {
    expect(sanitizeHtml('<textarea>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</textarea>',
        { allowedTags: [ 'textarea' ] }
      )).toBe('<textarea>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</textarea>');
  });
  it('should allow protocol relative links by default', function() {
    expect(sanitizeHtml('<a href="//cnn.com/example">test</a>')).toBe('<a href="//cnn.com/example">test</a>');
  });
  it('should not allow protocol relative links when allowProtocolRelative is false', function() {
    expect(sanitizeHtml('<a href="//cnn.com/example">test</a>', { allowProtocolRelative: false })).toBe('<a>test</a>');
    expect(sanitizeHtml('<a href="/\\cnn.com/example">test</a>', { allowProtocolRelative: false })).toBe('<a>test</a>');
    expect(sanitizeHtml('<a href="\\\\cnn.com/example">test</a>', { allowProtocolRelative: false })).toBe('<a>test</a>');
    expect(sanitizeHtml('<a href="\\/cnn.com/example">test</a>', { allowProtocolRelative: false })).toBe('<a>test</a>');
  });
  it('should still allow regular relative URLs when allowProtocolRelative is false', function() {
    expect(sanitizeHtml('<a href="/welcome">test</a>', { allowProtocolRelative: false })).toBe('<a href="/welcome">test</a>');
  });
  it('should discard srcset by default', function() {
    expect(sanitizeHtml('<img src="fallback.jpg" srcset="foo.jpg 100w 2x, bar.jpg 200w 1x" />', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ])
      })).toBe('<img src="fallback.jpg" />');
  });
  it('should accept srcset if allowed', function() {
    expect(sanitizeHtml('<img src="fallback.jpg" srcset="foo.jpg 100w, bar.jpg 200w" />', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
        allowedAttributes: { img: [ 'src', 'srcset' ] }
      })).toBe('<img src="fallback.jpg" srcset="foo.jpg 100w, bar.jpg 200w" />');
    expect(sanitizeHtml('<img src="fallback.jpg" srcset="foo.jpg 2x, bar.jpg 1x" />', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
        allowedAttributes: { img: [ 'src', 'srcset' ] }
      })).toBe('<img src="fallback.jpg" srcset="foo.jpg 2x, bar.jpg 1x" />');
  });
  it('should drop bogus srcset', function() {
    expect(sanitizeHtml('<img src="fallback.jpg" srcset="foo.jpg 100w, bar.jpg 200w, javascript:alert(1) 100w" />', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
        allowedAttributes: { img: [ 'src', 'srcset' ] }
      })).toBe('<img src="fallback.jpg" srcset="foo.jpg 100w, bar.jpg 200w" />');
  });
  it('should accept srcset with urls containing commas', function() {
    expect(sanitizeHtml('<img src="fallback.jpg" srcset="/upload/f_auto,q_auto:eco,c_fit,w_1460,h_2191/abc.jpg 1460w, /upload/f_auto,q_auto:eco,c_fit,w_1360,h_2041/abc.jpg" />', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
        allowedAttributes: { img: [ 'src', 'srcset' ] }
      })).toBe('<img src="fallback.jpg" srcset="/upload/f_auto,q_auto:eco,c_fit,w_1460,h_2191/abc.jpg 1460w, /upload/f_auto,q_auto:eco,c_fit,w_1360,h_2041/abc.jpg" />');
  });

  it('text from transformTags should not specify tags', function() {
    const input = '<input value="&lt;script&gt;alert(1)&lt;/script&gt;">';
    const want = '<u class="inlined-input">&lt;script&gt;alert(1)&lt;/script&gt;</u>';
    // Runs the sanitizer with a policy that turns an attribute into
    // text.  A policy like this might be used to turn inputs into
    // inline elements that look like the original but which do not
    // affect form submissions.
    const got = sanitizeHtml(
      input,
      {
        allowedTags: [ 'u' ],
        allowedAttributes: { '*': [ 'class' ] },
        transformTags: {
          input: function (tagName, attribs) {
            return {
              tagName: 'u',
              attribs: { class: 'inlined-input' },
              text: attribs.value
            };
          }
        }
      });
    expect(got).toBe(want);
  });
  it('drop attribute names with meta-characters', function() {
    expect(sanitizeHtml('<span data-<script>alert(1)//>', {
        allowedTags: [ 'span' ],
        allowedAttributes: { span: [ 'data-*' ] }
      })).toBe('<span>alert(1)//&gt;</span>');
  });
  it('should sanitize styles correctly', function() {
    const sanitizeString = '<p dir="ltr"><strong>beste</strong><em>testestes</em><s>testestset</s><u>testestest</u></p><ul dir="ltr"> <li><u>test</u></li></ul><blockquote dir="ltr"> <ol> <li><u>test</u></li><li><u>test</u></li><li style="text-align: right"><u>test</u></li><li style="text-align: justify"><u>test</u></li></ol> <p><u><span style="color:#00FF00">test</span></u></p><p><span style="color:#00FF00"><span style="font-size:36px">TESTETESTESTES</span></span></p></blockquote>';
    const expected = '<p dir="ltr"><strong>beste</strong><em>testestes</em><s>testestset</s><u>testestest</u></p><ul dir="ltr"> <li><u>test</u></li></ul><blockquote dir="ltr"> <ol> <li><u>test</u></li><li><u>test</u></li><li style="text-align: right"><u>test</u></li><li style="text-align: justify"><u>test</u></li></ol> <p><u><span style="color:#00FF00">test</span></u></p><p><span style="color:#00FF00"><span style="font-size:36px">TESTETESTESTES</span></span></p></blockquote>';
    expect(sanitizeHtml(sanitizeString, {
        allowedTags: false,
        allowedAttributes: {
          '*': [ 'dir' ],
          p: [ 'dir', 'style' ],
          li: [ 'style' ],
          span: [ 'style' ]
        },
        allowedStyles: {
          '*': {
            // Matches hex
            color: [ /#(0x)?[0-9a-f]+/i ],
            'text-align': [ /left/, /right/, /center/, /justify/, /initial/, /inherit/ ],
            'font-size': [ /36px/ ]
          }
        }
      }).replace(/ /g, '')).toBe(expected.replace(/ /g, ''));
  });
  it('Should remove empty style tags', function() {
    expect(sanitizeHtml('<span style=\'\'></span>', {
        allowedTags: false,
        allowedAttributes: false
      })).toBe('<span></span>');
  });
  it('Should remove invalid styles', function() {
    expect(sanitizeHtml('<span style=\'color: blue; text-align: justify\'></span>', {
        allowedTags: false,
        allowedAttributes: {
          span: [ 'style' ]
        },
        allowedStyles: {
          span: {
            color: [ /blue/ ],
            'text-align': [ /left/ ]
          }
        }
      })).toBe('<span style="color:blue"></span>');
  });
  it('Should ignore styles when options.parseStyleAttributes is false', function() {
    expect(sanitizeHtml('<span style=\'color: blue; text-align: justify\'></span>', {
        allowedTags: false,
        allowedAttributes: {
          span: [ 'style' ]
        },
        parseStyleAttributes: false
      })).toBe('<span style="color: blue; text-align: justify"></span>');
  });
  it('Should throw an error if both allowedStyles is set and  && parseStyleAttributes is set to false', function() {
    try {
      sanitizeHtml('<span style=\'color: blue; text-align: justify\'></span>', {
        allowedTags: false,
        allowedAttributes: {
          span: [ 'style' ]
        },
        allowedStyles: {
          p: {
            'text-align': [ /^justify$/ ]
          }
        },
        parseStyleAttributes: false
      });
      expect(false).toBeTruthy();
    } catch (err) {
      expect(err.message).toBe('allowedStyles option cannot be used together with parseStyleAttributes: false.');
    }
  });
  it('Should support !important styles', function() {
    expect(sanitizeHtml('<span style=\'color: blue !important\'></span>', {
        allowedTags: false,
        allowedAttributes: {
          span: [ 'style' ]
        },
        allowedStyles: {
          span: {
            color: [ /blue/ ]
          }
        }
      })).toBe('<span style="color:blue !important"></span>');
  });
  it('Should allow a specific style from global', function() {
    expect(sanitizeHtml('<span style=\'color: yellow; text-align: center; font-family: helvetica\'></span>', {
        allowedTags: false,
        allowedAttributes: {
          span: [ 'style' ]
        },
        allowedStyles: {
          '*': {
            color: [ /yellow/ ],
            'text-align': [ /center/ ]
          },
          span: {
            color: [ /green/ ],
            'font-family': [ /helvetica/ ]
          }
        }
      })).toBe('<span style="color:yellow;text-align:center;font-family:helvetica"></span>');
  });
  it('should delete the script tag', function() {
    expect(sanitizeHtml('<script src="https://www.unauthorized.com/lib.js"></script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptHostnames: [ 'www.authorized.com' ]
    })).toBe('<script></script>');
  });
  it('should delete the script tag since src is not a valid URL', function() {
    expect(sanitizeHtml('<script src="not-a-valid-url"></script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptHostnames: [ 'www.unauthorized.com' ]
    })).toBe('<script></script>');
  });
  it('Should allow domains in a script that are in allowedScriptDomains', function() {
    expect(sanitizeHtml('<script src="https://www.safe.authorized.com/lib.js"></script>', {
        allowedTags: [ 'script' ],
        allowedAttributes: {
          script: [ 'src' ]
        },
        allowedScriptDomains: [ 'authorized.com' ]
      })).toBe('<script src="https://www.safe.authorized.com/lib.js"></script>');
  });
  it('should delete the script tag content', function() {
    expect(sanitizeHtml('<script src="https://www.authorized.com/lib.js"> alert("evil") </script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptHostnames: [ 'www.authorized.com' ]
    })).toBe('<script src="https://www.authorized.com/lib.js"></script>');
  });
  it('should delete the script tag content from script tags with no src when allowedScriptHostnames is present', function() {
    expect(sanitizeHtml('<script>alert("evil")</script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptHostnames: [ 'www.authorized.com' ]
    })).toBe('<script></script>');
  });
  it('should delete the script tag content from script tags with no src when allowedScriptDomains is present', function() {
    expect(sanitizeHtml('<script>alert("evil")</script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptDomains: [ 'www.authorized.com' ]
    })).toBe('<script></script>');
  });
  it('Should allow hostnames in a script that are in allowedScriptHostnames', function() {
    expect(sanitizeHtml('<script src="https://www.authorized.com/lib.js"></script>', {
      allowedTags: [ 'script' ],
      allowVulnerableTags: true,
      allowedAttributes: {
        script: [ 'src' ]
      },
      allowedScriptHostnames: [ 'www.authorized.com' ]
    })).toBe('<script src="https://www.authorized.com/lib.js"></script>');
  });
  it('Should allow hostnames in an iframe that are in allowedIframeHostnames', function() {
    expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ]
      })).toBe('<iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should remove iframe src urls that are not included in allowedIframeHostnames', function() {
    expect(sanitizeHtml('<iframe src="https://www.embed.vevo.com/USUV71704255"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('Should not allow iframe urls that do not have proper hostname', function() {
    expect(sanitizeHtml('<iframe src="https://www.vimeo.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('Should allow iframe through if no hostname option is set', function() {
    expect(sanitizeHtml('<iframe src="https://www.vimeo.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        }
      })).toBe('<iframe src="https://www.vimeo.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow domains in an iframe that are in allowedIframeDomains', function() {
    expect(sanitizeHtml('<iframe src="https://www.foo.us02web.zoom.us/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeDomains: [ 'zoom.us' ]
      })).toBe('<iframe src="https://www.foo.us02web.zoom.us/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow second-level domains in an iframe that are in allowedIframeDomains', function() {
    expect(sanitizeHtml('<iframe src="https://zoom.us/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeDomains: [ 'zoom.us' ]
      })).toBe('<iframe src="https://zoom.us/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should remove iframe src urls that are not included in allowedIframeDomains', function() {
    expect(sanitizeHtml('<iframe src="https://www.prefix.us02web.zoom.us/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeDomains: [ 'vimeo.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('Should remove iframe src urls with host that ends as allowed domains but not preceded with a dot', function() {
    expect(sanitizeHtml('<iframe src="https://www.zoomzoom.us/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeDomains: [ 'zoom.us' ]
      })).toBe('<iframe></iframe>');
  });
  it('Should allow hostnames in an iframe that are in allowedIframeHostnames and are not in allowedIframeDomains', function() {
    expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ],
        allowedIframeDomains: [ 'zoom.us' ]
      })).toBe('<iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow hostnames in an iframe that are not in allowedIframeHostnames ' +
     'and are allowlisted in allowedIframeDomains', function() {
    expect(sanitizeHtml('<iframe src="https://www.us02web.zoom.us/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ],
        allowedIframeDomains: [ 'zoom.us' ]
      })).toBe('<iframe src="https://www.us02web.zoom.us/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow relative URLs for iframes by default', function() {
    expect(sanitizeHtml('<iframe src="/foo"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        }
      })).toBe('<iframe src="/foo"></iframe>');
  });
  it('Should allow relative URLs for iframes', function() {
    expect(sanitizeHtml('<iframe src="/foo"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowIframeRelativeUrls: true
      })).toBe('<iframe src="/foo"></iframe>');
  });
  it('Should remove relative URLs for iframes', function() {
    expect(sanitizeHtml('<iframe src="/foo"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowIframeRelativeUrls: false
      })).toBe('<iframe></iframe>');
  });
  it('Should remove relative URLs for iframes when other hostnames are specified in allowedIframeHostnames', function() {
    expect(sanitizeHtml('<iframe src="/foo"></iframe><iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ]
      })).toBe('<iframe></iframe><iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow relative and allowlisted hostname URLs for iframes', function() {
    expect(sanitizeHtml('<iframe src="/foo"></iframe><iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowIframeRelativeUrls: true,
        allowedIframeHostnames: [ 'www.youtube.com' ]
      })).toBe('<iframe src="/foo"></iframe><iframe src="https://www.youtube.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should allow protocol-relative URLs for the right domain for iframes', function() {
    expect(sanitizeHtml('<iframe src="//www.youtube.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ]
      })).toBe('<iframe src="//www.youtube.com/embed/c2IlcS7AHxM"></iframe>');
  });
  it('Should not allow protocol-relative iframe urls that do not have proper hostname', function() {
    expect(sanitizeHtml('<iframe src="//www.vimeo.com/embed/c2IlcS7AHxM"></iframe>', {
        allowedTags: [ 'p', 'iframe', 'a', 'img', 'i' ],
        allowedAttributes: {
          iframe: [ 'src', 'href' ],
          a: [ 'src', 'href' ],
          img: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com', 'player.vimeo.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('Should only allow attributes to have any combination of specific values', function() {
    expect(sanitizeHtml('<iframe name="IFRAME" allowfullscreen="true" sandbox="allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-top-navigation"></iframe>', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'iframe' ]),
        allowedAttributes: {
          iframe: [
            {
              name: 'sandbox',
              multiple: true,
              values: [ 'allow-popups', 'allow-same-origin', 'allow-scripts' ]
            },
            'allowfullscreen'
          ]
        }
      })).toBe('<iframe allowfullscreen="true" sandbox="allow-popups allow-same-origin allow-scripts"></iframe>');
  });
  it('Should only allow attributes that match a specific value', function() {
    expect(sanitizeHtml('<iframe sandbox="allow-popups allow-modals"></iframe><iframe sandbox="allow-popups"></iframe><iframe sandbox="allow-scripts"></iframe>', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'iframe' ]),
        allowedAttributes: {
          iframe: [
            {
              name: 'sandbox',
              multiple: false,
              values: [ 'allow-popups', 'allow-same-origin', 'allow-scripts' ]
            }
          ]
        }
      })).toBe('<iframe sandbox></iframe><iframe sandbox="allow-popups"></iframe><iframe sandbox="allow-scripts"></iframe>');
  }
  );
  it('Should not allow cite urls that do not have an allowed scheme', function() {
    expect(sanitizeHtml('<q cite="http://www.google.com">HTTP</q><q cite="https://www.google.com">HTTPS</q><q cite="mailto://www.google.com">MAILTO</q><q cite="tel://www.google.com">TEL</q><q cite="ms-calculator:">ms-calculator</q><q cite="ftp://www.google.com">FTP</q><q cite="data://www.google.com">DATA</q><q cite="ldap://www.google.com">LDAP</q><q cite="acrobat://www.google.com">ACROBAT</q><q cite="vbscript://www.google.com">VBSCRIPT</q><q cite="file://www.google.com">FILE</q><q cite="rlogin://www.google.com">RLOGIN</q><q cite="webcal://www.google.com">WEBCAL</q><q cite="javascript://www.google.com">JAVASCRIPT</q><q cite="mms://www.google.com">MMS</q>', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'q' ]),
        allowedAttributes: { q: [ 'cite' ] },
        allowedSchemes: sanitizeHtml.defaults.allowedSchemes.concat([ 'tel' ])
      })).toBe('<q cite="http://www.google.com">HTTP</q><q cite="https://www.google.com">HTTPS</q><q cite="mailto://www.google.com">MAILTO</q><q cite="tel://www.google.com">TEL</q><q>ms-calculator</q><q cite="ftp://www.google.com">FTP</q><q>DATA</q><q>LDAP</q><q>ACROBAT</q><q>VBSCRIPT</q><q>FILE</q><q>RLOGIN</q><q>WEBCAL</q><q>JAVASCRIPT</q><q>MMS</q>');
  });
  it('Should encode &, <, > and where necessary, "', function() {
    expect(sanitizeHtml('"< & >" <span class="&#34;test&#34;">cool</span>', {
      allowedTags: [ 'span' ],
      allowedAttributes: {
        span: [ 'class' ]
      }
    })).toBe('"&lt; &amp; &gt;" <span class="&quot;test&quot;">cool</span>');
  });
  it('Should not pass through &0; unescaped if decodeEntities is true (the default)', function() {
    expect(sanitizeHtml('<img src="<0&0;0.2&" />', { allowedTags: [ 'img' ] })).toBe('<img src="&lt;0&amp;0;0.2&amp;" />');
  });
  it('Should not double encode ampersands on HTML entities if decodeEntities is false (TODO more tests, this is too loose to rely upon)', function() {
    const textIn = 'This &amp; & that &reg; &#x0000A; &#10; &plusmn; OK?';
    const expectedResult = 'This &amp; &amp; that &reg; &#x0000A; &#10; &plusmn; OK?';
    const sanitizeHtmlOptions = {
      parser: {
        decodeEntities: false
      }
    };
    expect(sanitizeHtml(textIn, sanitizeHtmlOptions)).toBe(expectedResult);
  });
  // TODO: make this test and similar tests for entities that are not
  // strictly valid pass, at which point decodeEntities: false is safe
  // to use.
  //
  // it('Should not pass through &0;
  // (a bogus entity) unescaped if decodeEntities is false', function() {
  //   assert.equal(sanitizeHtml(
  //     '<img src="<0&0;0.2&" />', {
  //       allowedTags: ['img'],
  //       parser: {
  //         decodeEntities: false
  //       }
  //     }), '<img src="&lt;0&amp;0;0.2&amp;" />');
  // });
  it('should escape markup not allowlisted and all its children in recursive mode', function() {
    expect(sanitizeHtml('<div><wiggly>Hello<p>World</p></wiggly></div>', { disallowedTagsMode: 'recursiveEscape' })).toBe('<div>&lt;wiggly&gt;Hello&lt;p&gt;World&lt;/p&gt;&lt;/wiggly&gt;</div>');
  });
  it('should escape markup not allowlisted and but not its children', function() {
    expect(sanitizeHtml('<div><wiggly>Hello<p>World</p></wiggly></div>', { disallowedTagsMode: 'escape' })).toBe('<div>&lt;wiggly&gt;Hello<p>World</p>&lt;/wiggly&gt;</div>');
  });
  it('should escape markup even when decodeEntities is false', function() {
    expect(sanitizeHtml('<wiggly>Hello</wiggly>', {
        disallowedTagsMode: 'escape',
        parser: { decodeEntities: false }
      })).toBe('&lt;wiggly&gt;Hello&lt;/wiggly&gt;');
  });
  it('should escape markup not allowlisted even within allowed markup', function() {
    expect(sanitizeHtml('<div><wiggly>Hello<p>World</p><tiggly>JS</tiggly></wiggly></div>', { disallowedTagsMode: 'recursiveEscape' })).toBe('<div>&lt;wiggly&gt;Hello&lt;p&gt;World&lt;/p&gt;&lt;tiggly&gt;JS&lt;/tiggly&gt;&lt;/wiggly&gt;</div>');
  });
  it('should escape markup not allowlisted even within allowed markup, but not the allowed markup itself', function() {
    expect(sanitizeHtml('<div><wiggly>Hello<p>World</p><tiggly>JS</tiggly></wiggly></div>', { disallowedTagsMode: 'escape' })).toBe('<div>&lt;wiggly&gt;Hello<p>World</p>&lt;tiggly&gt;JS&lt;/tiggly&gt;&lt;/wiggly&gt;</div>');
  });
  it('allows markup of depth 6 with a nestingLimit of depth 6', function() {
    expect(sanitizeHtml('<div><div><div><div><div><div></div></div></div></div></div></div>', { nestingLimit: 6 })).toBe('<div><div><div><div><div><div></div></div></div></div></div></div>');
  });
  it('disallows markup of depth 7 with a nestingLimit of depth 6', function() {
    expect(// 7 divs here
      sanitizeHtml('<div><div><div><div><div><div><div>nested text</div></div></div></div></div></div></div>', { nestingLimit: 6 })).toBe(// only 6 kept
      '<div><div><div><div><div><div>nested text</div></div></div></div></div></div>');
  });
  it('should not allow simple append attacks on iframe hostname validation', function() {
    expect(sanitizeHtml('<iframe src=//www.youtube.comissocool>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('should not allow IDNA (Internationalized Domain Name) iframe validation bypass attacks', function() {
    expect(sanitizeHtml('<iframe src=//www.youtube.com%C3%9E.93.184.216.34.nip.io>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ]
      })).toBe('<iframe></iframe>');
  });
  it('should parse path-rooted relative URLs sensibly', function() {
    expect(sanitizeHtml('<a href="/foo"></a>')).toBe('<a href="/foo"></a>');
  });
  it('should parse bare relative URLs sensibly', function() {
    expect(sanitizeHtml('<a href="foo"></a>')).toBe('<a href="foo"></a>');
  });
  it('should parse ../ relative URLs sensibly', function() {
    expect(sanitizeHtml('<a href="../../foo"></a>')).toBe('<a href="../../foo"></a>');
  });
  it('should parse protocol relative URLs sensibly', function() {
    expect(sanitizeHtml('<a href="//foo.com/foo"></a>')).toBe('<a href="//foo.com/foo"></a>');
  });
  it('should reject attempts to hack our use of a relative: protocol in our test base URL', function() {
    expect(sanitizeHtml('<iframe src="relative://relative-test/aha">', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        }
      })).toBe('<iframe></iframe>');
  });
  it('Should prevent hostname bypass using protocol-relative src', function () {
    expect(sanitizeHtml('<iframe src="/\\example.com"></iframe>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ],
        allowIframeRelativeUrls: true
      })).toBe('<iframe></iframe>');
    expect(sanitizeHtml('<iframe src="\\/example.com"></iframe>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ],
        allowIframeRelativeUrls: true
      })).toBe('<iframe></iframe>');
    const linefeed = decodeURIComponent('%0A');
    expect(sanitizeHtml('<iframe src="/' + linefeed + '\\example.com"></iframe>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ],
        allowIframeRelativeUrls: true
      })).toBe('<iframe></iframe>');
    const creturn = decodeURIComponent('%0D');
    expect(sanitizeHtml('<iframe src="/' + creturn + '\\example.com"></iframe>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ],
        allowIframeRelativeUrls: true
      })).toBe('<iframe></iframe>');
    const tab = decodeURIComponent('%09');
    expect(sanitizeHtml('<iframe src="/' + tab + '\\example.com"></iframe>', {
        allowedTags: [ 'iframe' ],
        allowedAttributes: {
          iframe: [ 'src' ]
        },
        allowedIframeHostnames: [ 'www.youtube.com' ],
        allowIframeRelativeUrls: true
      })).toBe('<iframe></iframe>');
  });
  it('Should allow protocol-relative URLs for script tag', function() {
    expect(sanitizeHtml('<script src="//example.com/script.js"></script>', {
        allowedTags: [ 'script' ],
        allowedAttributes: {
          script: [ 'src' ]

        }
      })).toBe('<script src="//example.com/script.js"></script>');
  });
  it('should not automatically attach close tag for escaped tags in escape mode', function() {
    expect(sanitizeHtml('<test>Hello', {
      disallowedTagsMode: 'escape'
    })).toBe('&lt;test&gt;Hello');
  });
  it('should not automatically attach close tag for escaped tags in recursiveEscape mode', function() {
    expect(sanitizeHtml('<test><test><test><test><test>Hello', {
      disallowedTagsMode: 'recursiveEscape'
    })).toBe('&lt;test&gt;&lt;test&gt;&lt;test&gt;&lt;test&gt;&lt;test&gt;Hello');
  });
  it('should discard unclosed disallowed tags', function() {
    expect(sanitizeHtml('<test>Hello', {
      disallowedTagsMode: 'discard'
    })).toBe('Hello');
  });
  it('should escape unclosed tags without closing bracket in escape mode', function() {
    expect(sanitizeHtml('<hello', {
      disallowedTagsMode: 'escape'
    })).toBe('&lt;hello');
  });
  it('should escape unclosed tags without closing bracket in recursiveEscape mode', function() {
    expect(sanitizeHtml('<hello', {
      disallowedTagsMode: 'recursiveEscape'
    })).toBe('&lt;hello');
  });
  it('should escape unclosed tags with attributes but no closing bracket in escape mode', function() {
    expect(sanitizeHtml('<hello you', {
      disallowedTagsMode: 'escape'
    })).toBe('&lt;hello you');
  });
  it('should escape unclosed tags with attributes but no closing bracket in recursiveEscape mode', function() {
    expect(sanitizeHtml('<hello you', {
      disallowedTagsMode: 'recursiveEscape'
    })).toBe('&lt;hello you');
  });
  it('should discard unclosed tags without closing bracket in discard mode', function() {
    expect(sanitizeHtml('<hello', {
      disallowedTagsMode: 'discard'
    })).toBe('');
  });
  it('should escape text followed by unclosed tag in escape mode', function() {
    expect(sanitizeHtml('Hello <world', {
      disallowedTagsMode: 'escape'
    })).toBe('Hello &lt;world');
  });
  it('should escape text followed by unclosed tag in recursiveEscape mode', function() {
    expect(sanitizeHtml('Hello <world', {
      disallowedTagsMode: 'recursiveEscape'
    })).toBe('Hello &lt;world');
  });
  it('should remove non-boolean attributes that are empty', function() {
    expect(sanitizeHtml('<a href target="_blank">hello</a>', {
    })).toBe('<a target="_blank">hello</a>');
  });
  it('should not remove non-boolean attributes that are empty when disabled', function() {
    expect(sanitizeHtml('<a href target="_blank">hello</a>', {
      nonBooleanAttributes: []
    })).toBe('<a href target="_blank">hello</a>');
  });
  it('should not remove boolean attributes that are empty', function() {
    expect(sanitizeHtml('<input checked form type="checkbox" />', {
      allowedTags: 'input',
      allowedAttributes: {
        input: [ 'checked', 'form', 'type' ]
      }
    })).toBe('<input checked type="checkbox" />');
  });
  it('should remove boolean attributes that are empty when wildcard * passed in', function() {
    expect(sanitizeHtml('<input checked form type="checkbox" />', {
      allowedTags: 'input',
      allowedAttributes: {
        input: [ 'checked', 'form', 'type' ]
      },
      nonBooleanAttributes: [ '*' ]
    })).toBe('<input type="checkbox" />');
  });
  it('should not remove empty alt attribute value by default', function() {
    expect(sanitizeHtml('<img alt="" src="https://example.com/" />', {
      allowedAttributes: { img: [ 'alt', 'src' ] },
      allowedTags: [ 'img' ]
    })).toBe('<img alt="" src="https://example.com/" />');
  });
  it('should convert the implicit empty alt attribute value to be an empty string by default', function() {
    expect(sanitizeHtml('<img alt src="https://example.com/" />', {
      allowedAttributes: { img: [ 'alt', 'src' ] },
      allowedTags: [ 'img' ]
    })).toBe('<img alt="" src="https://example.com/" />');
  });
  it('should not remove empty alt attribute value by default when an empty nonBooleanAttributes option passed in', function() {
    expect(sanitizeHtml('<img alt="" src="https://example.com/" />', {
      allowedAttributes: { img: [ 'alt', 'src' ] },
      allowedTags: [ 'img' ],
      nonBooleanAttributes: []
    })).toBe('<img alt="" src="https://example.com/" />');
  });
  it('should not remove the empty attributes specified in allowedEmptyAttributes option', function() {
    expect(sanitizeHtml('<img alt="" src="" />', {
      allowedAttributes: { img: [ 'alt', 'src' ] },
      allowedTags: [ 'img' ],
      allowedEmptyAttributes: [ 'alt', 'src' ]
    })).toBe('<img alt="" src="" />');
  });
  it('should remove all the empty attributes when an empty allowedEmptyAttributes option passed in', function() {
    expect(sanitizeHtml('<img alt="" src="https://example.com/" target="" />', {
      allowedAttributes: { img: [ 'alt', 'src' ] },
      allowedTags: [ 'img' ],
      allowedEmptyAttributes: []
    })).toBe('<img src="https://example.com/" />');
  });
  it('should support SVG tags', () => {
    expect(sanitizeHtml('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="myGradient" gradientTransform="rotate(90)"><stop offset="5%" stop-color="gold"></stop><stop offset="95%" stop-color="red"></stop></linearGradient></defs><circle cx="5" cy="5" r="4" fill="url(\'#myGradient\')"></circle></svg>', {
      allowedTags: [ 'svg', 'g', 'defs', 'linearGradient', 'stop', 'circle' ],
      allowedAttributes: false,
      parser: {
        lowerCaseTags: false,
        lowerCaseAttributeNames: false
      }
    })).toBe('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="myGradient" gradientTransform="rotate(90)"><stop offset="5%" stop-color="gold"></stop><stop offset="95%" stop-color="red"></stop></linearGradient></defs><circle cx="5" cy="5" r="4" fill="url(\'#myGradient\')"></circle></svg>');
  });
  it('should not process style sourceMappingURL with postCSS', () => {
    expect(sanitizeHtml('<a style=\'background-image: url("/*# sourceMappingURL=../index.js */");\'></a>', {
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: [ 'style' ]
      }
    })).toBe('<a style="background-image:url(&quot;/*# sourceMappingURL=../index.js */&quot;)"></a>');
  });
  it('should completely remove disallowed tags with nested content', () => {
    const inputHtml = '<div>Some Text<p>Allowed content</p><script>var x = "Disallowed script";</script><span>More allowed content</span> Another Text</div>';
    const expectedOutput = '<p>Allowed content</p><span>More allowed content</span>';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [ 'p', 'span' ],
      disallowedTagsMode: 'completelyDiscard'
    });
    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should remove top level tag\'s content', () => {
    const inputHtml = 'Some Text<p>paragraph content</p> content';
    const expectedOutput = '<p>paragraph content</p>';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [ 'p' ],
      disallowedTagsMode: 'completelyDiscard'
    });
    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should completely remove disallowed tag with unclosed tag', () => {
    const inputHtml = '<div>Some Text<p>paragraph content</p>some text';
    const expectedOutput = '<p>paragraph content</p>';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [ 'p' ],
      disallowedTagsMode: 'completelyDiscard'
    });

    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should transform text content of tags even if they originally had none', () => {
    const inputHtml = '<div></div>';
    const expectedOutput = 'new content';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [],
      transformTags: {
        div: () => ({ text: 'new content' })
      }
    });

    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should call onOpenTag and onCloseTag callbacks', () => {
    const onOpenTag = vi.fn();
    const onCloseTag = vi.fn();
    const inputHtml = '<div id="one">Some Text<p id="two">paragraph content</p><p id="three">some text</div>';
    sanitizeHtml(inputHtml, {
      allowedTags: [ 'p' ],
      onOpenTag,
      onCloseTag
    });
    expect(onOpenTag.mock.calls.length).toBe(3);
    expect(onOpenTag.mock.calls[0]).toEqual(['div', { id: 'one' }]);
    expect(onOpenTag.mock.calls[1]).toEqual(['p', { id: 'two' }]);
    expect(onOpenTag.mock.calls[2]).toEqual(['p', { id: 'three' }]);
    expect(onCloseTag.mock.calls.length).toBe(3);
    expect(onCloseTag.mock.calls[0]).toEqual(['p', false]);
    expect(onCloseTag.mock.calls[1]).toEqual(['p', true]);
    expect(onCloseTag.mock.calls[2]).toEqual(['div', false]);
  });
  it('should insert spaces between removed tags whose content we keep', () => {
    const inputHtml = 'Text&#39;s here<div>it&#39;s here</div><div><p>it&#39;s there</p></div>and <b>also</b> here';
    const expectedOutput = 'Text\'s here it\'s here it\'s there and <b>also</b> here';
    const allowedTags = [ 'b' ];
    let addSpace = false;
    const sanitizedHtml = sanitizeHtml(
      inputHtml,
      {
        allowedTags,
        onOpenTag: (tag) => {
          addSpace = !allowedTags.includes(tag);
        },
        onCloseTag: (tag) => {
          addSpace = !allowedTags.includes(tag);
        },
        textFilter: (text) => {
          if (addSpace) {
            addSpace = false;
            return ' ' + text;
          }
          return text;
        }
      }
    );
    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should not preserve attributes on escaped disallowed tags when `preserveEscapedAttributes` is false', () => {
    const inputHtml = '<div class="foo">Some Text</div>';
    const expectedOutput = '&lt;div&gt;Some Text&lt;/div&gt;';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [],
      disallowedTagsMode: 'escape',
      preserveEscapedAttributes: false
    });

    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should preserve attributes on escaped disallowed tags when `preserveEscapedAttributes` is true', () => {
    const inputHtml = '<div class="foo">Some Text</div>';
    const expectedOutput = '&lt;div class="foo"&gt;Some Text&lt;/div&gt;';
    const sanitizedHtml = sanitizeHtml(inputHtml, {
      allowedTags: [],
      disallowedTagsMode: 'escape',
      preserveEscapedAttributes: true
    });

    expect(sanitizedHtml).toBe(expectedOutput);
  });
  it('should ignore the `preserveEscapedAttributes` option when discarding diallowed tags (rather than escaping)', () => {
    const inputHtml = '<div class="foo">Some Text</div>';
    const sanitizedHtmlPreservedAttrsTrue = sanitizeHtml(inputHtml, {
      allowedTags: [],
      disallowedTagsMode: 'discard',
      preserveEscapedAttributes: true
    });
    const sanitizedHtmlPreservedAttrsFalse = sanitizeHtml(inputHtml, {
      allowedTags: [],
      disallowedTagsMode: 'discard',
      preserveEscapedAttributes: false
    });

    expect(sanitizedHtmlPreservedAttrsTrue).toBe(sanitizedHtmlPreservedAttrsFalse);
  });
  it('should not allow script tag injection via escaped entities in option tag', () => {
    const inputHtml = '<option>&lt;script&gt;alert(1)&lt;/script&gt;</option>';
    const result = sanitizeHtml(inputHtml, { allowedTags: ['option'] });
    expect(result).toBe('<option>&lt;script&gt;alert(1)&lt;/script&gt;</option>');
  });
  it('should not double-encode entities inside an allowed option element', function() {
    expect(sanitizeHtml('<option>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</option>',
        { allowedTags: [ 'option' ] }
      )).toBe('<option>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</option>');
  });
  it('should not double-encode entities inside an allowed xmp element', function() {
    expect(sanitizeHtml('<xmp>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</xmp>',
        { allowedTags: [ 'xmp' ] }
      )).toBe('<xmp>&lt;div&gt;hello&lt;/div&gt;&amp;amp;</xmp>');
  });
  it('should correctly maintain escaping when allowing an xmp element', function() {
    expect(sanitizeHtml('!<xmp>&lt;/xmp&gt;&lt;svg/onload=prompt`xs`&gt;</xmp>!',
        { allowedTags: [ 'xmp' ] }
      )).toBe('!<xmp>&lt;/xmp&gt;&lt;svg/onload=prompt`xs`&gt;</xmp>!');
  });
});
