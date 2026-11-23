// Product categories. Each one gets its own page tab and data file (public/data/<id>.json).
// `include` / `exclude` are regexes tested against the product name (upper-cased)
// to drop accessories that stores list inside the category.

export const categories = {
  tv: {
    label: 'TVs',
    include: /\b(TV|TELEVIZOR|OLED|QLED|QNED|LED|MINI ?LED)\b/,
    exclude:
      /MBAJTESE|KABELL|KABLL|ANTEN|TELEKOMAND|SOUNDBAR|TV ?BOX|RECEIVER|MARRES|DVB-?T2 TR|STAND|SUPORT|BRACKET|PROJEKTOR|PROJECTOR|MONITOR/,
    minSize: 19, // inches; anything smaller is not a TV
  },
  // Example for later:
  // phones: { label: 'Phones', include: /./, exclude: /KELLEF|CASE|MBROJTESE|KARIKUES|KABELL/ },
};
