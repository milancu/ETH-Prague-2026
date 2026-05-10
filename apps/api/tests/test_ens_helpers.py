"""Tests for slugify + ENS name helpers."""

from api.lib.ens import ens_analysis_name_for, ens_name_for, slugify


def test_slugify_handles_czech_diacritics() -> None:
    assert slugify("Jestli Česko vyhraje nad Švédy") == (
        "jestli-cesko-vyhraje-nad-svedy"
    )


def test_slugify_strips_punctuation() -> None:
    assert slugify("Bitcoin >$200,000 by Dec 31?") == "bitcoin-200000-by-dec-31"


def test_slugify_max_40_chars() -> None:
    long = "a" * 100
    assert len(slugify(long)) == 40


def test_slugify_returns_empty_for_only_diacritics() -> None:
    # All chars transliterate to nothing recognisable, fall back path:
    assert slugify("???!!!") == ""


def test_ens_name_for_uses_slug() -> None:
    assert (
        ens_name_for(16, "Česko vs Švédy") == "cesko-vs-svedy.kowalski.eth"
    )


def test_ens_name_for_falls_back_when_slug_empty() -> None:
    assert ens_name_for(7, "???") == "market-7.kowalski.eth"


def test_ens_analysis_name_for_prefixes_analysis() -> None:
    assert (
        ens_analysis_name_for(16, "Česko vs Švédy")
        == "analysis-cesko-vs-svedy.kowalski.eth"
    )


def test_ens_analysis_name_for_falls_back_when_slug_empty() -> None:
    assert ens_analysis_name_for(7, "???") == "analysis-market-7.kowalski.eth"
