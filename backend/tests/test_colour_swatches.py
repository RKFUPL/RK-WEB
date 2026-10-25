from app.blueprints.admin.routes import _colour_swatches


def test_colour_swatches_keep_only_valid_hex_values_and_normalize_names():
    assert _colour_swatches({" blue ": "#235a9f", "invalid": "blue", "empty": ""}) == {"BLUE": "#235A9F"}


def test_colour_swatches_preserve_existing_valid_entries_when_merged_by_route_contract():
    current = _colour_swatches({"BLUE": "#235A9F", "CUSTOM": "#123456"})
    current.update(_colour_swatches({"BLUE": "#abcdef"}))
    assert current == {"BLUE": "#ABCDEF", "CUSTOM": "#123456"}
