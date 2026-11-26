"""Read-only relevance over the public catalogue record, never private product notes."""
import re
import unicodedata


def normalise(value):
    return re.sub(r"[\W_]+", " ", unicodedata.normalize('NFKC', str(value or '')).casefold()).strip()


def text_values(value):
    if isinstance(value, dict):
        return ' '.join(text_values(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return ' '.join(text_values(item) for item in value)
    return str(value or '')


def product_fields(record):
    variants = record.get('variants') or []
    return {
        'sku': [record.get('sku'), record.get('parentSku'), *(v.get('sku') for v in variants)],
        'code': [record.get('productCode'), record.get('styleCode')],
        'name': [record.get('name')],
        'metadata': [record.get('category'), record.get('attributes'), record.get('_search_variant_names'),
                     *(v.get(key) for v in variants for key in ('name', 'colour', 'colourSlug')),
                     *(c.get(key) for c in record.get('collections') or [] for key in ('name', 'slug'))],
        'description': [record.get('skuPrefix'), record.get('style'), record.get('description'), record.get('shortDescription'), record.get('_search_metadata')],
    }


def matches_product(record, query):
    terms = normalise(query).split()
    if not terms:
        return not query
    fields = product_fields(record)
    # A single common character in prose is not useful evidence of relevance.
    if len(''.join(terms)) == 1:
        return any(normalise(value).startswith(terms[0]) for key in ('name', 'sku', 'code') for value in fields[key] if value)
    compact = ''.join(terms)
    if any(normalise(value).replace(' ', '') == compact for key in ('sku', 'code') for value in fields[key] if value):
        return True
    haystack = normalise(text_values(fields))
    return all(term in haystack for term in terms)


def relevance(record, query):
    wanted = normalise(query)
    compact = wanted.replace(' ', '')
    fields = product_fields(record)
    for index, key in enumerate(('sku', 'code', 'name')):
        values = [normalise(v) for v in fields[key] if v]
        if any(value == wanted or (key != 'name' and value.replace(' ', '') == compact) for value in values):
            return 100 - index * 10
    name = normalise(record.get('name'))
    if name.startswith(wanted):
        return 65
    if wanted in name or all(term in name for term in wanted.split()):
        return 60
    if all(term in normalise(text_values(fields['metadata'])) for term in wanted.split()):
        return 40
    return 20


def matching_variant(record, query):
    wanted = normalise(query)
    variants = record.get('variants') or []
    for variant in variants:
        if normalise(variant.get('sku')).replace(' ', '') == wanted.replace(' ', ''):
            return variant.get('id')
    for variant in variants:
        fields = normalise(text_values([variant.get('sku'), variant.get('colour'), variant.get('colourSlug')]))
        if wanted and all(term in fields for term in wanted.split()):
            return variant.get('id')
    return None


def suggestions(records, query):
    seen, result = set(), []
    for record in records:
        values = [record.get('name'), record.get('category'), record.get('productCode'), record.get('styleCode'),
                  *(v.get('sku') for v in record.get('variants') or []), *(c.get('name') for c in record.get('collections') or []),
                  *(v.get('colour') for v in record.get('variants') or []),
                  *((record.get('attributes') or {}).get(key) for key in ('fabric', 'material'))]
        for value in values:
            text = str(value or '').strip()
            key = normalise(text)
            if key and key not in seen and len(text) <= 100 and all(t in key for t in normalise(query).split()):
                seen.add(key)
                result.append(text)
    return result[:8]
