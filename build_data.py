"""Build countries.json from World Bank population and crude birth rates."""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

UN_MEMBERS = {
    "AFG", "ALB", "DZA", "AND", "AGO", "ATG", "ARG", "ARM", "AUS", "AUT", "AZE",
    "BHS", "BHR", "BGD", "BRB", "BLR", "BEL", "BLZ", "BEN", "BTN", "BOL", "BIH",
    "BWA", "BRA", "BRN", "BGR", "BFA", "BDI", "CPV", "KHM", "CMR", "CAN", "CAF",
    "TCD", "CHL", "CHN", "COL", "COM", "COG", "COD", "CRI", "CIV", "HRV", "CUB",
    "CYP", "CZE", "DNK", "DJI", "DMA", "DOM", "ECU", "EGY", "SLV", "GNQ", "ERI",
    "EST", "SWZ", "ETH", "FJI", "FIN", "FRA", "GAB", "GMB", "GEO", "DEU", "GHA",
    "GRC", "GRD", "GTM", "GIN", "GNB", "GUY", "HTI", "HND", "HUN", "ISL", "IND",
    "IDN", "IRN", "IRQ", "IRL", "ISR", "ITA", "JAM", "JPN", "JOR", "KAZ", "KEN",
    "KIR", "PRK", "KOR", "KWT", "KGZ", "LAO", "LVA", "LBN", "LSO", "LBR", "LBY",
    "LIE", "LTU", "LUX", "MDG", "MWI", "MYS", "MDV", "MLI", "MLT", "MHL", "MRT",
    "MUS", "MEX", "FSM", "MDA", "MCO", "MNG", "MNE", "MAR", "MOZ", "MMR", "NAM",
    "NRU", "NPL", "NLD", "NZL", "NIC", "NER", "NGA", "MKD", "NOR", "OMN", "PAK",
    "PLW", "PAN", "PNG", "PRY", "PER", "PHL", "POL", "PRT", "QAT", "ROU", "RUS",
    "RWA", "KNA", "LCA", "VCT", "WSM", "SMR", "STP", "SAU", "SEN", "SRB", "SYC",
    "SLE", "SGP", "SVK", "SVN", "SLB", "SOM", "ZAF", "SSD", "ESP", "LKA", "SDN",
    "SUR", "SWE", "CHE", "SYR", "TJK", "TZA", "THA", "TLS", "TGO", "TON", "TTO",
    "TUN", "TUR", "TKM", "TUV", "UGA", "UKR", "ARE", "GBR", "USA", "URY", "UZB",
    "VUT", "VEN", "VNM", "YEM", "ZMB", "ZWE",
}

EXTRA_COUNTRIES = {"PSE", "XKX", "TWN", "VAT"}

SPANISH_NAMES = {
    "AFG": "Afganistán", "ALB": "Albania", "DZA": "Argelia", "AND": "Andorra",
    "AGO": "Angola", "ATG": "Antigua y Barbuda", "ARG": "Argentina", "ARM": "Armenia",
    "AUS": "Australia", "AUT": "Austria", "AZE": "Azerbaiyán", "BHS": "Bahamas",
    "BHR": "Baréin", "BGD": "Bangladés", "BRB": "Barbados", "BLR": "Bielorrusia",
    "BEL": "Bélgica", "BLZ": "Belice", "BEN": "Benín", "BTN": "Bután",
    "BOL": "Bolivia", "BIH": "Bosnia y Herzegovina", "BWA": "Botsuana", "BRA": "Brasil",
    "BRN": "Brunéi", "BGR": "Bulgaria", "BFA": "Burkina Faso", "BDI": "Burundi",
    "CPV": "Cabo Verde", "KHM": "Camboya", "CMR": "Camerún", "CAN": "Canadá",
    "CAF": "República Centroafricana", "TCD": "Chad", "CHL": "Chile", "CHN": "China",
    "COL": "Colombia", "COM": "Comoras", "COG": "Congo", "COD": "República Democrática del Congo",
    "CRI": "Costa Rica", "CIV": "Costa de Marfil", "HRV": "Croacia", "CUB": "Cuba",
    "CYP": "Chipre", "CZE": "Chequia", "DNK": "Dinamarca", "DJI": "Yibuti",
    "DMA": "Dominica", "DOM": "República Dominicana", "ECU": "Ecuador", "EGY": "Egipto",
    "SLV": "El Salvador", "GNQ": "Guinea Ecuatorial", "ERI": "Eritrea", "EST": "Estonia",
    "SWZ": "Esuatini", "ETH": "Etiopía", "FJI": "Fiyi", "FIN": "Finlandia",
    "FRA": "Francia", "GAB": "Gabón", "GMB": "Gambia", "GEO": "Georgia",
    "DEU": "Alemania", "GHA": "Ghana", "GRC": "Grecia", "GRD": "Granada",
    "GTM": "Guatemala", "GIN": "Guinea", "GNB": "Guinea-Bisáu", "GUY": "Guyana",
    "HTI": "Haití", "HND": "Honduras", "HUN": "Hungría", "ISL": "Islandia",
    "IND": "India", "IDN": "Indonesia", "IRN": "Irán", "IRQ": "Irak",
    "IRL": "Irlanda", "ISR": "Israel", "ITA": "Italia", "JAM": "Jamaica",
    "JPN": "Japón", "JOR": "Jordania", "KAZ": "Kazajistán", "KEN": "Kenia",
    "KIR": "Kiribati", "PRK": "Corea del Norte", "KOR": "Corea del Sur", "KWT": "Kuwait",
    "KGZ": "Kirguistán", "LAO": "Laos", "LVA": "Letonia", "LBN": "Líbano",
    "LSO": "Lesoto", "LBR": "Liberia", "LBY": "Libia", "LIE": "Liechtenstein",
    "LTU": "Lituania", "LUX": "Luxemburgo", "MDG": "Madagascar", "MWI": "Malaui",
    "MYS": "Malasia", "MDV": "Maldivas", "MLI": "Malí", "MLT": "Malta",
    "MHL": "Islas Marshall", "MRT": "Mauritania", "MUS": "Mauricio", "MEX": "México",
    "FSM": "Micronesia", "MDA": "Moldavia", "MCO": "Mónaco", "MNG": "Mongolia",
    "MNE": "Montenegro", "MAR": "Marruecos", "MOZ": "Mozambique", "MMR": "Myanmar",
    "NAM": "Namibia", "NRU": "Nauru", "NPL": "Nepal", "NLD": "Países Bajos",
    "NZL": "Nueva Zelanda", "NIC": "Nicaragua", "NER": "Níger", "NGA": "Nigeria",
    "MKD": "Macedonia del Norte", "NOR": "Noruega", "OMN": "Omán", "PAK": "Pakistán",
    "PLW": "Palaos", "PAN": "Panamá", "PNG": "Papúa Nueva Guinea", "PRY": "Paraguay",
    "PER": "Perú", "PHL": "Filipinas", "POL": "Polonia", "PRT": "Portugal",
    "QAT": "Catar", "ROU": "Rumanía", "RUS": "Rusia", "RWA": "Ruanda",
    "KNA": "San Cristóbal y Nieves", "LCA": "Santa Lucía", "VCT": "San Vicente y las Granadinas",
    "WSM": "Samoa", "SMR": "San Marino", "STP": "Santo Tomé y Príncipe", "SAU": "Arabia Saudita",
    "SEN": "Senegal", "SRB": "Serbia", "SYC": "Seychelles", "SLE": "Sierra Leona",
    "SGP": "Singapur", "SVK": "Eslovaquia", "SVN": "Eslovenia", "SLB": "Islas Salomón",
    "SOM": "Somalia", "ZAF": "Sudáfrica", "SSD": "Sudán del Sur", "ESP": "España",
    "LKA": "Sri Lanka", "SDN": "Sudán", "SUR": "Surinam", "SWE": "Suecia",
    "CHE": "Suiza", "SYR": "Siria", "TJK": "Tayikistán", "TZA": "Tanzania",
    "THA": "Tailandia", "TLS": "Timor Oriental", "TGO": "Togo", "TON": "Tonga",
    "TTO": "Trinidad y Tobago", "TUN": "Túnez", "TUR": "Turquía", "TKM": "Turkmenistán",
    "TUV": "Tuvalu", "UGA": "Uganda", "UKR": "Ucrania", "ARE": "Emiratos Árabes Unidos",
    "GBR": "Reino Unido", "USA": "Estados Unidos", "URY": "Uruguay", "UZB": "Uzbekistán",
    "VUT": "Vanuatu", "VEN": "Venezuela", "VNM": "Vietnam", "YEM": "Yemen",
    "ZMB": "Zambia", "ZWE": "Zimbabue", "PSE": "Palestina", "XKX": "Kosovo",
    "TWN": "Taiwán", "VAT": "Ciudad del Vaticano",
}

REGION_FALLBACK_CBR = {
    "Africa": 32.0,
    "East Asia & Pacific": 12.0,
    "Europe & Central Asia": 9.5,
    "Latin America & Caribbean": 14.5,
    "Middle East & North Africa": 20.0,
    "North America": 11.0,
    "South Asia": 18.0,
}

MANUAL = {
    "TWN": {
        "name": "Taiwan",
        "iso2": "TW",
        "region": "East Asia & Pacific",
        "population": 23_400_000,
        "cbr": 5.8,
        "year": 2024,
    },
    "VAT": {
        "name": "Holy See",
        "iso2": "VA",
        "region": "Europe & Central Asia",
        "population": 800,
        "cbr": 2.5,
        "year": 2024,
    },
}


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "bldeces-wheel/1.0"})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode())


def fetch_hdi() -> dict[str, dict]:
    url = (
        "https://ourworldindata.org/grapher/human-development-index.csv"
        "?v=1&csvType=full&useColumnShortNames=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "bldeces-wheel/1.0"})
    with urllib.request.urlopen(req, timeout=90) as response:
        text = response.read().decode("utf-8")
    latest = {}
    for row in csv.DictReader(io.StringIO(text)):
        code = (row.get("Code") or "").strip()
        value = row.get("Human Development Index")
        if not code or not value:
            continue
        year = int(row["Year"])
        prev = latest.get(code)
        if prev is None or year > prev["year"]:
            latest[code] = {"hdi": float(value), "year": year}
    latest.setdefault("TWN", {"hdi": 0.926, "year": 2023})
    latest.setdefault("XKX", {"hdi": 0.762, "year": 2022})
    return latest


def hdi_band(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 0.800:
        return "very-high"
    if value >= 0.700:
        return "high"
    if value >= 0.550:
        return "medium"
    return "low"


def indicator_map(indicator: str) -> dict[str, dict]:
    url = (
        f"https://api.worldbank.org/v2/country/all/indicator/{indicator}"
        "?format=json&mrnev=1&per_page=500"
    )
    payload = fetch_json(url)[1]
    out = {}
    for row in payload:
        iso3 = row.get("countryiso3code")
        if iso3 and row.get("value") is not None:
            out[iso3] = {"value": float(row["value"]), "year": int(row["date"])}
    return out


def main() -> None:
    wanted = UN_MEMBERS | EXTRA_COUNTRIES
    print("Fetching World Bank metadata...")
    meta = fetch_json("https://api.worldbank.org/v2/country?format=json&per_page=400")[1]
    meta_by_id = {row["id"]: row for row in meta}

    print("Fetching population...")
    pop = indicator_map("SP.POP.TOTL")
    print("Fetching crude birth rate...")
    cbr = indicator_map("SP.DYN.CBRT.IN")
    print("Fetching HDI...")
    hdi = fetch_hdi()

    countries = []
    missing = []
    for iso3 in sorted(wanted):
        info = meta_by_id.get(iso3, {})
        manual = MANUAL.get(iso3, {})
        population = pop.get(iso3, {}).get("value") or manual.get("population")
        birth_rate = cbr.get(iso3, {}).get("value")
        year = cbr.get(iso3, {}).get("year") or pop.get(iso3, {}).get("year") or manual.get("year")
        region = info.get("region", {}).get("value") or manual.get("region") or "Unknown"
        iso2 = (info.get("iso2Code") or manual.get("iso2") or "").lower()
        english = info.get("name") or manual.get("name") or iso3

        if birth_rate is None:
            birth_rate = manual.get("cbr") or REGION_FALLBACK_CBR.get(region, 18.0)

        if population is None:
            missing.append(iso3)
            continue

        births = max(1.0, population * birth_rate / 1000.0)
        hdi_row = hdi.get(iso3)
        hdi_value = round(hdi_row["hdi"], 3) if hdi_row else None
        countries.append(
            {
                "iso3": iso3,
                "iso2": iso2,
                "name": SPANISH_NAMES.get(iso3, english),
                "nameEn": english,
                "region": region,
                "population": int(round(population)),
                "cbr": round(float(birth_rate), 3),
                "births": int(round(births)),
                "year": year,
                "hdi": hdi_value,
                "hdiYear": hdi_row["year"] if hdi_row else None,
                "hdiBand": hdi_band(hdi_value),
            }
        )

    total_births = sum(c["births"] for c in countries)
    for country in countries:
        country["probability"] = country["births"] / total_births

    countries.sort(key=lambda c: c["births"], reverse=True)

    payload = {
        "source": "Banco Mundial (población y natalidad más recientes), PNUD / Our World in Data para el IDH (2023), y estimaciones para Taiwán y el Vaticano.",
        "method": "Nacimientos anuales ≈ población × (nacimientos por 1.000 habitantes) / 1.000. La probabilidad de cada país es nacimientos del país / nacimientos mundiales. El IDH sigue las bandas del PNUD: muy alto ≥ 0,800; alto ≥ 0,700; medio ≥ 0,550; bajo < 0,550.",
        "hdiNote": "Bandas del PNUD: muy alto ≥ 0,800; alto ≥ 0,700; medio ≥ 0,550; bajo < 0,550.",
        "totalBirths": total_births,
        "totalPopulation": sum(c["population"] for c in countries),
        "count": len(countries),
        "countries": countries,
    }

    out_dir = Path(__file__).parent / "data"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / "countries.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {out_path}")
    print(f"Countries: {len(countries)}  missing: {missing}")
    print(f"Total births: {total_births:,.0f}")
    print("Top 10:")
    for country in countries[:10]:
        print(
            f"  {country['name']:28} {country['probability']*100:6.2f}%  "
            f"{country['births']:,} nacimientos"
        )


if __name__ == "__main__":
    main()
