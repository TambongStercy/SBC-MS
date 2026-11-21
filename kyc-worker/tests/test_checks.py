from app.checks import country_code, email_info, level1, normalized_email, operator_family, phone_info, random_looking

MX = {"gmail.com": True, "yahoo.fr": True, "nomail.example": False, "slow.example": None, "mailinator.com": True}
mx = lambda d: MX.get(d, True)


def test_country_names_and_codes():
    assert country_code("Cameroun") == "CM"
    assert country_code("CONGO-BRAZZAVILLE") == "CG"
    assert country_code("bj") == "BJ"
    assert country_code("XX") is None and country_code("T1") is None
    assert country_code("") is None and country_code(None) is None


def test_phone_formats():
    cm = phone_info("237670000001")
    assert cm["valid"] and cm["region"] == "CM" and cm["operator"] == "MTN" and cm["type"] == "mobile"
    assert phone_info("+237 690 00 00 01")["operator"] == "ORANGE"
    # national number without its dialling code, read with the declared country
    assert phone_info("670000001", "CM")["region"] == "CM"
    # Benin before the 2024 renumbering: 01 + the old 8 digits
    bj = phone_info("22997000000")
    assert bj["valid"] and bj["legacy"] and bj["region"] == "BJ" and bj["operator"] == "MTN"
    # Côte d'Ivoire before 2021: valid, operator unknown
    ci = phone_info("22507000000")
    assert ci["valid"] and ci["legacy"] and ci["operator"] is None
    assert phone_info("2376700")["valid"] is False
    assert phone_info("") is None and phone_info(None) is None


def test_operator_families():
    assert operator_family("MTN_MOMO_CMR") == "MTN"
    assert operator_family("ORANGE_MOMO_CMR") == "ORANGE"
    assert operator_family("MOOV_TG") == "MOOV"
    assert operator_family("Yas", "SN") == "FREE" and operator_family("Yas", "TG") == "TMONEY"
    assert operator_family("WAVE_CIV") == "WAVE"
    assert operator_family("MPESA_KEN") == "MPESA" and operator_family("Safaricom") == "MPESA"


def test_email_checks():
    e = email_info("Jean.Mbarga+sbc@gmail.com", mx)
    assert e["syntax"] and e["mx"] and e["free"] and e["plusTag"] and e["gmailDots"] and not e["disposable"]
    assert normalized_email("Jean.Mbarga+sbc@GoogleMail.com") == "jeanmbarga@gmail.com"
    assert normalized_email("a.b+x@yahoo.fr") == "a.b@yahoo.fr"
    assert email_info("x@mailinator.com", mx)["disposable"]
    assert email_info("x@nomail.example", mx)["mx"] is False
    assert email_info("x@slow.example", mx)["mx"] is None
    assert email_info("not-an-email", mx)["syntax"] is False


def test_random_looking():
    for s in ["xk7q2m9z4p", "qwrtzplkm", "a8f3k2l9d0x"]:
        assert random_looking(s), s
    for s in ["jeanpierre.mbarga", "tchouamou2019", "aminata.diallo", "kouassi.yao85", "fatou", "ngono.marie.claire"]:
        assert not random_looking(s), s


def test_level1_clean_member():
    r = level1({"ref": "a", "email": "aminata.diallo@gmail.com", "phone": "237670000001", "country": "Cameroun",
                "ipCountry": "CM", "momoNumber": "237670000001", "momoOperator": "MTN_MOMO_CMR"}, mx)
    assert r["score"] == 0 and r["band"] == "low" and r["reasons"] == []
    assert r["signals"]["momo"]["operatorMatch"] is True
    assert r["emailNormalized"] == "aminatadiallo@gmail.com"


def test_level1_risky_member():
    r = level1({"ref": "b", "email": "xk7q2m9z4p@mailinator.com", "phone": "22997000000", "country": "CM",
                "ipCountry": "FR", "momoNumber": "237690000001", "momoOperator": "MTN_MOMO_CMR"}, mx)
    assert set(r["reasons"]) == {"email_disposable", "email_random", "momo_operator_mismatch", "phone_country_vs_declared", "network_country_elsewhere"}
    assert r["score"] == 40 + 10 + 10 + 15 + 10 and r["band"] == "high"


def test_level1_unknown_dns_never_scores_and_wave_never_compared():
    r = level1({"ref": "c", "email": "kouassi@slow.example", "phone": "2250700000000", "country": "CI",
                "momoNumber": "2250500000000", "momoOperator": "WAVE_CIV"}, mx)
    assert r["reasons"] == [] and r["signals"]["email"]["mx"] is None
    assert r["signals"]["momo"]["operatorMatch"] is None


def test_level1_missing_fields():
    r = level1({"ref": "d"}, mx)
    assert r["score"] == 0 and r["signals"]["phone"] is None and r["signals"]["email"] is None and r["emailNormalized"] is None
