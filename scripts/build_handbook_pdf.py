"""Render the maintained SaSSy CRM Markdown handbook as a navigable PDF.

Requires reportlab and pypdf. Uses local fonts; performs no network calls.
Run from any directory: python scripts/build_handbook_pdf.py
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, KeepTogether, LongTable, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle, XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'SASSY_CRM_GUIDE.md'
OUTPUT = ROOT / 'output' / 'pdf' / 'SaSSy_CRM_Handbook.pdf'
PROOF = ROOT / 'tmp' / 'pdfs' / 'sassy-handbook-proof'
PAGE_W, PAGE_H = A4
MARGIN = 48
TOP = 53
BOTTOM = 45
WIDTH = PAGE_W - 2 * MARGIN
HEIGHT = PAGE_H - TOP - BOTTOM
NAVY = colors.HexColor('#102B46')
TEAL = colors.HexColor('#087E8B')
INK = colors.HexColor('#25384B')
MUTED = colors.HexColor('#617487')
LINE = colors.HexColor('#D5E0E9')
PALE = colors.HexColor('#EFF5F8')


def register_fonts():
    windows = Path('C:/Windows/Fonts')
    candidates = {
        'Body': windows / 'segoeui.ttf',
        'BodyBold': windows / 'segoeuib.ttf',
        'BodyItalic': windows / 'segoeuii.ttf',
        'BodyBoldItalic': windows / 'segoeuiz.ttf',
        'Mono': windows / 'consola.ttf',
        'MonoBold': windows / 'consolab.ttf',
    }
    if not all(p.exists() for p in candidates.values()):
        raise RuntimeError('Required Segoe UI/Consolas fonts not found; configure local font paths.')
    for name, filename in candidates.items():
        pdfmetrics.registerFont(TTFont(name, str(filename)))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBoldItalic')
    pdfmetrics.registerFontFamily('Mono', normal='Mono', bold='MonoBold', italic='Mono', boldItalic='MonoBold')


def normalize(text):
    return (text.replace('\u2011', '-').replace('\u2010', '-')
            .replace('\u2013', '-').replace('\u2014', '-')
            .replace('\u2212', '-').replace('\u00a0', ' ')
            .replace('\u2192', '->').replace('\u2190', '<-')
            .replace('\u200b', ''))


def slug(text):
    return re.sub(r'\s', '-', re.sub(r'[^\w\s-]', '', text.lower()))


def inline(text):
    """Convert the limited inline Markdown used by the maintained handbook."""
    out = []
    cursor = 0
    pattern = r'(`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*\*.+?\*\*)'
    for match in re.finditer(pattern, text):
        out.append(html.escape(normalize(text[cursor:match.start()])))
        token = match.group(0)
        if token.startswith('`'):
            out.append('<font name="Mono" size="8.9">' + html.escape(normalize(token[1:-1])) + '</font>')
        elif token.startswith('**'):
            out.append('<b>' + inline(token[2:-2]) + '</b>')
        else:
            link = re.fullmatch(r'\[([^\]]+)\]\(([^\s)]+)\)', token)
            label, target = link.groups()
            if target.startswith(('https://', 'http://', '#')):
                out.append(f'<link href="{html.escape(target, quote=True)}" color="#087E8B">{inline(label)}</link>')
            else:
                # Repository-relative files are not portable download links.
                # Preserve their descriptive labels without broken PDF actions.
                out.append(inline(label))
        cursor = match.end()
    out.append(html.escape(normalize(text[cursor:])))
    return ''.join(out)


def styles():
    base = dict(fontName='Body', fontSize=10.1, leading=14.0, textColor=INK,
                splitLongWords=True, allowWidows=0, allowOrphans=0, rightIndent=2)
    return {
        'body': ParagraphStyle('body', **base, spaceAfter=5),
        'list': ParagraphStyle('list', **base, leftIndent=16, bulletIndent=1, spaceAfter=3.5),
        'h2': ParagraphStyle('chapter', fontName='BodyBold', fontSize=23, leading=28, textColor=NAVY,
                             spaceAfter=14, keepWithNext=True),
        'h3': ParagraphStyle('section', fontName='BodyBold', fontSize=12.1, leading=16, textColor=NAVY,
                             spaceBefore=11, spaceAfter=6, keepWithNext=True),
        'h4': ParagraphStyle('subsection', fontName='BodyBold', fontSize=10.5, leading=14.5, textColor=TEAL,
                             spaceBefore=9, spaceAfter=5, keepWithNext=True),
        'kicker': ParagraphStyle('kicker', fontName='BodyBold', fontSize=8.3, leading=11, textColor=TEAL,
                                spaceBefore=1, spaceAfter=6, keepWithNext=True),
        'cell': ParagraphStyle('cell', fontName='Body', fontSize=9, leading=12.2, textColor=INK,
                              splitLongWords=True, spaceAfter=0),
        'thead': ParagraphStyle('thead', fontName='BodyBold', fontSize=9, leading=12.1, textColor=colors.white,
                               splitLongWords=True),
        'callout': ParagraphStyle('callout', fontName='Body', fontSize=9.7, leading=13.8, textColor=NAVY,
                                 splitLongWords=True),
        'small': ParagraphStyle('small', fontName='Body', fontSize=8.7, leading=12, textColor=MUTED, spaceAfter=8),
    }


class Cover(Flowable):
    def __init__(self):
        super().__init__()
        self.width = WIDTH
        self.height = HEIGHT - 2

    def draw(self):
        c = self.canv
        c.setFillColor(TEAL)
        c.roundRect(0, self.height - 37, 112, 25, 5, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont('BodyBold', 9)
        c.drawString(12, self.height - 29, 'PRODUCT HANDBOOK')
        c.setFillColor(NAVY)
        c.setFont('BodyBold', 49)
        c.drawString(-2, self.height - 146, 'SaSSy CRM')
        c.setFont('Body', 26)
        c.drawString(0, self.height - 194, 'From first login')
        c.drawString(0, self.height - 229, 'to reliable automation.')
        c.setFillColor(MUTED)
        c.setFont('Body', 12)
        c.drawString(0, self.height - 271, 'Setup, daily operations, team access, and integrations')
        c.drawString(0, self.height - 291, 'with a complete Make.com scenario-creation chapter.')

        top = self.height - 337
        c.setStrokeColor(LINE)
        c.line(0, top, WIDTH, top)
        topics = [
            ('01', 'GET STARTED', 'Accounts, workspaces, and the daily CRM workflow'),
            ('02', 'OPERATE', 'Supabase, Cloudflare, teams, and platform care'),
            ('03', 'AUTOMATE', 'Make, WhatsApp Business API, and Brevo email'),
        ]
        for index, (num, title, description) in enumerate(topics):
            y = top - 39 - index * 65
            c.setFont('BodyBold', 12)
            c.setFillColor(TEAL)
            c.drawString(0, y, num)
            c.setFillColor(NAVY)
            c.setFont('BodyBold', 10)
            c.drawString(35, y, title)
            c.setFont('Body', 10.5)
            c.setFillColor(MUTED)
            c.drawString(35, y - 19, description)
        c.setFillColor(PALE)
        c.roundRect(0, 55, WIDTH, 65, 7, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.setFont('BodyBold', 10)
        c.drawString(15, 97, 'A practical guide, with implementation boundaries clearly marked.')
        c.setFont('Body', 9.2)
        c.drawString(15, 79, 'Existing CRM features and future delivery services are documented separately.')
        c.setFillColor(MUTED)
        c.setFont('BodyBold', 9)
        c.drawString(0, 18, '2 OCTOBER 2026')
        c.setFont('Body', 9)
        c.drawRightString(WIDTH, 18, 'React  /  Supabase  /  Cloudflare  /  Make')


class HandbookDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(str(path), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=TOP, bottomMargin=BOTTOM, title='SaSSy CRM Handbook',
                         author='SaSSy CRM', subject='Setup, management, Make automation, WhatsApp and Brevo',
                         pageCompression=1, allowSplitting=1)
        self.current_chapter = 'Handbook'
        self.headings = []
        self.addPageTemplates(PageTemplate('main', [Frame(MARGIN, BOTTOM, WIDTH, HEIGHT,
                                                        leftPadding=0, rightPadding=0,
                                                        topPadding=0, bottomPadding=0)],
                                          onPageEnd=self.draw_page_end))

    def beforeDocument(self):
        self.current_chapter = 'Handbook'
        self.headings = []

    def draw_page_end(self, canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - 34, PAGE_W - MARGIN, PAGE_H - 34)
        canvas.setFillColor(TEAL)
        canvas.setFont('BodyBold', 8)
        canvas.drawString(MARGIN, PAGE_H - 24, 'SaSSy CRM  /  HANDBOOK')
        canvas.setFillColor(MUTED)
        canvas.setFont('Body', 8)
        heading = normalize(self.current_chapter)
        while pdfmetrics.stringWidth(heading, 'Body', 8) > 300:
            heading = heading[:-4] + '...'
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 24, heading)
        canvas.line(MARGIN, 33, PAGE_W - MARGIN, 33)
        canvas.setFont('Body', 7.8)
        canvas.drawString(MARGIN, 21, 'SETUP  /  OPERATIONS  /  AUTOMATIONS')
        canvas.drawRightString(PAGE_W - MARGIN, 21, f'{doc.page}')
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if hasattr(flowable, '_running'):
            self.current_chapter = flowable._running
        if hasattr(flowable, '_anchor'):
            self.canv.bookmarkPage(flowable._anchor)
            self.canv.addOutlineEntry(flowable._heading, flowable._anchor, flowable._level, closed=True)
            self.headings.append({'title': flowable._heading, 'page': self.page, 'anchor': flowable._anchor})
            if getattr(flowable, '_toc', False):
                self.notify('TOCEntry', (flowable._level, html.escape(flowable._heading), self.page, flowable._anchor))


def table_widths(rows):
    n = len(rows[0])
    lengths = [sum(len(re.sub(r'[`*]', '', str(row[i]))) for row in rows) / len(rows) for i in range(n)]
    weights = [max(14, item) ** 0.5 for item in lengths]
    if n == 3:
        return [WIDTH * x / sum(weights) for x in weights]
    minimum = WIDTH * {2: 0.33, 3: 0.23, 4: 0.19}.get(n, 0.12)
    flexible = WIDTH - n * minimum
    return [minimum + flexible * x / sum(weights) for x in weights]


def table_flow(rows, st):
    data = [[Paragraph(inline(cell), st['thead' if i == 0 else 'cell']) for cell in row] for i, row in enumerate(rows)]
    t = LongTable(data, colWidths=table_widths(rows), repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, NAVY),
        ('LINEBELOW', (0, 1), (-1, -1), 0.3, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def code_flow(content, language, st):
    content = normalize(content)
    widest = max((pdfmetrics.stringWidth(line, 'Mono', 8.6) for line in content.splitlines()), default=0)
    font_size = min(8.6, 8.6 * (WIDTH - 22) / max(widest, 1))
    if font_size < 7.0:
        raise ValueError(f'Code line too wide to typeset readably: {language}')
    code_style = ParagraphStyle('code', fontName='Mono', fontSize=font_size, leading=font_size * 1.4,
                                textColor=NAVY, spaceAfter=0)
    label = Paragraph((language or 'EXAMPLE').upper(), st['kicker'])
    label.keepWithNext = True
    p = XPreformatted(html.escape(content), code_style)
    box = Table([[p]], colWidths=[WIDTH], hAlign='LEFT')
    box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('LINEBEFORE', (0, 0), (0, -1), 2, TEAL),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
    ]))
    return [label, box, Spacer(1, 10)]


def render_markdown(text, st, chapter_breaks=True):
    lines = text.splitlines()
    result = []
    i = 0

    def is_start(line):
        return (not line.strip() or line.startswith(('```', '|', '#', '> '))
                or re.match(r'^\s*(?:- |\d+\. )', line))

    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('```'):
            language = line[3:].strip()
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i])
                i += 1
            result.extend(code_flow('\n'.join(block), language, st))
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell.replace(' ', '')) for cell in cells):
                    rows.append(cells)
                i += 1
            if len({len(row) for row in rows}) != 1:
                raise ValueError('Inconsistent table column count')
            result.extend([table_flow(rows, st), Spacer(1, 11)])
            continue
        if line.startswith('> '):
            parts = []
            while i < len(lines) and lines[i].startswith('> '):
                parts.append(lines[i][2:])
                i += 1
            box = Table([[Paragraph(inline(' '.join(parts)), st['callout'])]], colWidths=[WIDTH], hAlign='LEFT')
            box.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), PALE),
                ('LINEBEFORE', (0, 0), (0, -1), 3, TEAL),
                ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
                ('TOPPADDING', (0, 0), (-1, -1), 11), ('BOTTOMPADDING', (0, 0), (-1, -1), 11),
            ]))
            result.extend([box, Spacer(1, 10)])
            continue
        heading = re.match(r'^(#{2,4}) (.+)$', line)
        if heading:
            depth, title = len(heading[1]), heading[2]
            if depth == 2 and chapter_breaks:
                result.append(PageBreak())
                number = re.match(r'^(\d+)\. (.+)', title)
                if number:
                    result.append(Paragraph(f'CHAPTER {number[1].zfill(2)}', st['kicker']))
                    printable = number[2]
                else:
                    printable = title
            else:
                printable = title
            p = Paragraph(inline(printable), st[f'h{depth}'])
            p._anchor = slug(title)
            p._heading = normalize(title)
            p._level = depth - 2
            # Keep the printed contents compact; detailed Make sections remain
            # individually navigable in the PDF outline/bookmarks.
            p._toc = depth == 2
            if depth == 2:
                p._running = title
            result.append(p)
            i += 1
            continue
        item = re.match(r'^(-|\d+\.) (.+)$', line)
        if item:
            body = item[2]
            i += 1
            while i < len(lines) and not is_start(lines[i]):
                body += ' ' + lines[i].strip()
                i += 1
            result.append(Paragraph(inline(body), st['list'], bulletText=item[1]))
            continue
        parts = [line]
        i += 1
        while i < len(lines) and not is_start(lines[i]):
            parts.append(lines[i].strip())
            i += 1
        result.append(Paragraph(inline(' '.join(parts)), st['body']))
    if chapter_breaks:
        # Keep a short closing section intact instead of leaving a few final
        # bullets or one warning alone on a continuation page. KeepTogether
        # releases its children into the story, preserving heading bookmarks.
        balanced = []
        chapter = []

        def close_chapter(items):
            section_starts = [index for index, item in enumerate(items)
                              if getattr(item, '_level', 0) > 0]
            start = None
            for index in reversed(section_starts):
                height = sum(item.wrap(WIDTH, HEIGHT)[1]
                             + item.getSpaceBefore() + item.getSpaceAfter()
                             for item in items[index:])
                if height > 310:
                    break
                start = index
                if height >= 205:
                    break
            if start is not None:
                return items[:start] + [KeepTogether(items[start:])]
            return items

        for item in result:
            if isinstance(item, PageBreak):
                balanced.extend(close_chapter(chapter))
                balanced.append(item)
                chapter = []
            else:
                chapter.append(item)
        balanced.extend(close_chapter(chapter))
        return balanced
    return result


def main():
    register_fonts()
    st = styles()
    source = SOURCE.read_text(encoding='utf-8')
    if '### 15.10 Handover checklist and references' not in source:
        raise RuntimeError('The full Make walkthrough must be integrated before PDF generation.')
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PROOF.mkdir(parents=True, exist_ok=True)
    doc = HandbookDoc(OUTPUT)
    story = [Cover(), PageBreak()]
    intro_heading = Paragraph('How to use this handbook', st['h2'])
    intro_heading._running = 'How to use this handbook'
    story.append(intro_heading)
    intro = source[source.index('SaSSy CRM is a configurable'):source.index('## Contents')]
    story.extend(render_markdown(intro, st, chapter_breaks=False))
    story.append(Paragraph('Find your route', st['h3']))
    story.append(Paragraph('Business users: chapters 3-6. Platform operators: chapters 7-11 and 17-19. '
                           'Automation builders: chapters 12-16, including the complete Make creation walkthrough in chapter 15.', st['body']))
    story.append(Paragraph('The contents page and PDF bookmarks are clickable. Web references open external documentation. '
                           'Repository source references retain their filenames; they are not public download links. '
                           'Examples and placeholders must be reviewed before running commands or enabling live delivery.', st['small']))
    story.append(PageBreak())
    contents_heading = Paragraph('Contents', st['h2'])
    contents_heading._running = 'Contents'
    story.append(contents_heading)
    story.append(Paragraph('20 chapters, with the Make.com walkthrough integrated in chapter 15.', st['small']))
    toc = TableOfContents()
    toc.dotsMinLevel = 0
    toc.levelStyles = [
        ParagraphStyle('toc0', fontName='BodyBold', fontSize=9.3, leading=13.5, textColor=NAVY,
                       leftIndent=0, firstLineIndent=0, spaceBefore=5, rightIndent=20),
        ParagraphStyle('toc1', fontName='Body', fontSize=8.6, leading=11.8, textColor=MUTED,
                       leftIndent=14, firstLineIndent=0, spaceBefore=2, rightIndent=20),
    ]
    story.append(toc)
    content = source[source.index('## 1. Choose your starting point'):]
    story.extend(render_markdown(content, st))
    doc.multiBuild(story, maxPasses=4)
    reader = PdfReader(OUTPUT)
    report = {'pdf': str(OUTPUT), 'pages': len(reader.pages), 'source_words': len(source.split()),
              'heading_count': len(doc.headings), 'headings': doc.headings,
              'links': sum(len(page.get('/Annots', [])) for page in reader.pages)}
    (PROOF / 'layout.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'headings'}, indent=2))


if __name__ == '__main__':
    main()
