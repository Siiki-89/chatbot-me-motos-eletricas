"""Compatibilidade do XML exportado com o leitor ExcelJS do bot.

Não altera valores ou estilos. ExcelJS espera tags SpreadsheetML sem prefixo.
"""
import os
import sys
import zipfile
import xml.etree.ElementTree as ET

filename = sys.argv[1]
main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('', main)
ET.register_namespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
with zipfile.ZipFile(filename) as source, zipfile.ZipFile(filename + '.tmp', 'w', zipfile.ZIP_DEFLATED) as target:
    for entry in source.infolist():
        data = source.read(entry.filename)
        if entry.filename.endswith('.xml'):
            root = ET.fromstring(data)
            if root.tag.startswith('{' + main + '}'):
                data = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        target.writestr(entry, data)
os.replace(filename + '.tmp', filename)
