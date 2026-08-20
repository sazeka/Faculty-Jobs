const rows = [
  ["Bethany College (WV)", "WV", "private nonprofit", "4-year"],
  ["Casa Loma College - Aurora", "CO", "private for-profit", "4-year"],
  ["CU Anschutz", "CO", "public", "4-year"],
  ["CU Denver", "CO", "public", "4-year"],
  ["CUNY Advanced Science Research Center", "NY", "public", "4-year"],
  ["CUNY Language", "NY", "public", "4-year"],
  ["CUNY School of Professional Studies", "NY", "public", "4-year"],
  ["CUNY Start", "NY", "public", "4-year"],
  ["Delaware Technical Community College", "DE", "public", "2-year"],
  ["Fairleigh Dickinson University", "NJ", "private nonprofit", "4-year"],
  ["Los Angeles CCD", "CA", "public", "2-year"],
  ["Los Angeles Trade-Tech College", "CA", "public", "2-year"],
  ["Los Rios CCD", "CA", "public", "2-year"],
  ["Minneapolis College", "MN", "public", "2-year"],
  ["Minnesota State (2 Locations)", "MN", "public", "4-year"],
  ["Minnesota State System", "MN", "public", "4-year"],
  ["Peralta CCD", "CA", "public", "2-year"],
  ["Rutgers, The State University of New Jersey", "NJ", "public", "4-year"],
  ["San Diego College of Continuing Education", "CA", "public", "2-year"],
  ["South Dakota Board of Regents", "SD", "public", "4-year"],
  ["Southwestern College (KS)", "KS", "private nonprofit", "4-year"],
  ["St. John's College (Santa Fe)", "NM", "private nonprofit", "4-year"],
  ["St. John's University", "NY", "private nonprofit", "4-year"],
  ["St. Norbert College", "WI", "private nonprofit", "4-year"],
  ["SUNY Ncc", "NY", "public", "2-year"],
  ["SUNY System", "NY", "public", "4-year"],
  ["University of Alaska System", "AK", "public", "4-year"],
  ["University of Hawaii System", "HI", "public", "4-year"],
  ["University of Maine System", "ME", "public", "4-year"],
  ["University of New Hampshire System", "NH", "public", "4-year"],
  ["UW System Comprehensives", "WI", "public", "4-year"],
  ["Wyoming Catholic College", "WY", "private nonprofit", "4-year"],
];

const overrides = new Map(
  rows.map(([name, state, control, level]) => [name.toLowerCase(), { state, control, level }])
);

export function institutionMetadataOverride(name) {
  return overrides.get(String(name || "").trim().toLowerCase()) || null;
}

