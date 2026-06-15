-- Refuerza la búsqueda remota de contribuyentes en Caja Agua.

CREATE INDEX IF NOT EXISTS idx_contribuyentes_dni_ruc_digits
  ON contribuyentes (
    regexp_replace(COALESCE(dni_ruc, ''), '[^0-9]', '', 'g')
  );

CREATE INDEX IF NOT EXISTS idx_contribuyentes_codigo_municipal_search
  ON contribuyentes (
    UPPER(regexp_replace(COALESCE(codigo_municipal, ''), '\s+', '', 'g'))
  );

CREATE INDEX IF NOT EXISTS idx_contribuyentes_nombre_completo_search
  ON contribuyentes (
    TRANSLATE(
      UPPER(BTRIM(COALESCE(NULLIF(nombre_completo, ''), NULLIF(sec_nombre, ''), ''))),
      'ÁÉÍÓÚÜÑ',
      'AEIOUUN'
    )
  );
