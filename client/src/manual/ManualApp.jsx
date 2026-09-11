import { useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaBookOpen,
  FaCheckCircle,
  FaExclamationTriangle,
  FaPrint,
  FaSearch,
  FaTimes
} from "react-icons/fa";
import {
  getManualRoleLabel,
  getManualSection,
  MANUAL_ARTICLES,
  MANUAL_ROLES,
  MANUAL_SECTIONS
} from "./manualCatalog";

const normalizeText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const getInitialArticleId = () => {
  const hash = decodeURIComponent(String(window.location.hash || "").replace(/^#/, ""));
  return MANUAL_ARTICLES.some((article) => article.id === hash)
    ? hash
    : MANUAL_ARTICLES[0].id;
};

const riskMeta = {
  sensitive: {
    className: "manual-risk manual-risk--sensitive",
    label: "Operación sensible",
    text: "Compruebe el contribuyente, los datos y el resultado antes de confirmar."
  },
  critical: {
    className: "manual-risk manual-risk--critical",
    label: "Operación crítica",
    text: "Esta tarea cambia saldos, accesos o varios registros. Revise todo antes de confirmar."
  }
};

export default function ManualApp() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("TODOS");
  const [activeId, setActiveId] = useState(getInitialArticleId);

  const visibleArticles = useMemo(() => {
    const needle = normalizeText(query);
    return MANUAL_ARTICLES.filter((article) => {
      const roleMatches = role === "TODOS" || article.roles.includes(role);
      if (!roleMatches) return false;
      if (!needle) return true;
      const searchable = normalizeText([
        article.title,
        article.summary,
        ...(article.keywords || [])
      ].join(" "));
      return searchable.includes(needle);
    });
  }, [query, role]);

  const activeArticle = visibleArticles.find((article) => article.id === activeId)
    || visibleArticles[0]
    || null;
  const activeSection = activeArticle ? getManualSection(activeArticle.section) : null;

  const selectArticle = (articleId) => {
    setActiveId(articleId);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${articleId}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearSearch = () => {
    setQuery("");
    setRole("TODOS");
  };

  return (
    <div className="manual-app">
      <a className="app-skip-link" href="#manual-content">Saltar al contenido del manual</a>

      <header className="manual-header">
        <div className="manual-header__title">
          <span className="manual-header__icon" aria-hidden="true"><FaBookOpen /></span>
          <div>
            <div className="manual-header__eyebrow">Municipalidad Distrital de Pueblo Nuevo</div>
            <h1>Manual de uso del sistema</h1>
          </div>
        </div>
        <div className="manual-header__actions">
          <span className="badge text-bg-warning">En preparación</span>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => window.print()}>
            <FaPrint aria-hidden="true" /> Imprimir tema
          </button>
          <a className="btn btn-primary btn-sm" href="/">
            <FaArrowLeft aria-hidden="true" /> Volver al sistema
          </a>
        </div>
      </header>

      <div className="manual-layout">
        <aside className="manual-sidebar" aria-label="Índice del manual">
          <div className="manual-filter-panel">
            <label className="form-label fw-semibold" htmlFor="manual-role">Mostrar instrucciones para</label>
            <select
              id="manual-role"
              className="form-select"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {MANUAL_ROLES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <label className="form-label fw-semibold mt-3" htmlFor="manual-search">Buscar una tarea</label>
            <div className="input-group">
              <span className="input-group-text"><FaSearch aria-hidden="true" /></span>
              <input
                id="manual-search"
                type="search"
                className="form-control"
                placeholder="Ej. cobrar, tarifa, calle..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button type="button" className="btn btn-outline-secondary" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">
                  <FaTimes aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="manual-results-count" aria-live="polite">
              {visibleArticles.length} tema{visibleArticles.length === 1 ? "" : "s"} disponible{visibleArticles.length === 1 ? "" : "s"}
            </div>
          </div>

          <nav className="manual-index">
            {MANUAL_SECTIONS.map((section) => {
              const articles = visibleArticles.filter((article) => article.section === section.id);
              if (articles.length === 0) return null;
              return (
                <section key={section.id} className="manual-index__section" aria-labelledby={`manual-section-${section.id}`}>
                  <h2 id={`manual-section-${section.id}`}>{section.label}</h2>
                  <div className="manual-index__items">
                    {articles.map((article) => (
                      <button
                        key={article.id}
                        type="button"
                        className={`manual-index__item ${activeArticle?.id === article.id ? "is-active" : ""}`}
                        onClick={() => selectArticle(article.id)}
                        aria-current={activeArticle?.id === article.id ? "page" : undefined}
                      >
                        <span>{article.title}</span>
                        {article.stage === "ready" && <FaCheckCircle aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
        </aside>

        <main id="manual-content" className="manual-content" tabIndex="-1">
          {!activeArticle ? (
            <div className="manual-empty">
              <FaSearch aria-hidden="true" />
              <h2>No encontramos esa tarea</h2>
              <p>Pruebe otra palabra o vuelva a mostrar todos los perfiles.</p>
              <button type="button" className="btn btn-primary" onClick={clearSearch}>Limpiar filtros</button>
            </div>
          ) : (
            <article className="manual-article">
              <div className="manual-breadcrumb">{activeSection?.label || "Manual"}</div>
              <div className="manual-article__heading">
                <div>
                  <h2>{activeArticle.title}</h2>
                  <p className="manual-article__summary">{activeArticle.summary}</p>
                </div>
                <span className={`manual-status ${activeArticle.stage === "ready" ? "manual-status--ready" : "manual-status--planned"}`}>
                  {activeArticle.stage === "ready" ? "Disponible" : "Contenido programado"}
                </span>
              </div>

              <section className="manual-audience" aria-labelledby="manual-audience-title">
                <h3 id="manual-audience-title">¿A quién corresponde?</h3>
                <div className="manual-audience__roles">
                  {activeArticle.roles.map((articleRole) => (
                    <span key={articleRole} className="badge rounded-pill text-bg-light border">
                      {getManualRoleLabel(articleRole)}
                    </span>
                  ))}
                </div>
              </section>

              {activeArticle.risk && (
                <div className={riskMeta[activeArticle.risk].className} role="note">
                  <FaExclamationTriangle aria-hidden="true" />
                  <div>
                    <strong>{riskMeta[activeArticle.risk].label}</strong>
                    <p>{riskMeta[activeArticle.risk].text}</p>
                  </div>
                </div>
              )}

              {activeArticle.guide ? (
                <div className="manual-guide">
                  <section className="manual-checklist" aria-labelledby="manual-checklist-title">
                    <h3 id="manual-checklist-title">Antes de empezar</h3>
                    <ul>
                      {activeArticle.guide.before.map((item) => (
                        <li key={item}><FaCheckCircle aria-hidden="true" /><span>{item}</span></li>
                      ))}
                    </ul>
                  </section>

                  <section className="manual-procedure" aria-labelledby="manual-procedure-title">
                    <h3 id="manual-procedure-title">Paso a paso</h3>
                    <ol>
                      {activeArticle.guide.steps.map((step) => (
                        <li key={step.title}>
                          <strong>{step.title}</strong>
                          <p>{step.text}</p>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="manual-figures" aria-label="Capturas de referencia">
                    {activeArticle.guide.figures.map((figure) => (
                      <figure key={figure.src}>
                        <a href={figure.src} target="_blank" rel="noopener noreferrer" title="Abrir captura a tamaño completo">
                          <img src={figure.src} alt={figure.alt} loading="lazy" />
                        </a>
                        <figcaption>
                          {figure.caption} Datos e importes reemplazados para proteger la información municipal.
                        </figcaption>
                      </figure>
                    ))}
                  </section>

                  {activeArticle.guide.notes.map((note) => (
                    <div key={`${note.title}-${note.text}`} className={`manual-note manual-note--${note.tone}`} role="note">
                      <strong>{note.title}</strong>
                      <p>{note.text}</p>
                    </div>
                  ))}

                  <section className="manual-result" aria-labelledby="manual-result-title">
                    <FaCheckCircle aria-hidden="true" />
                    <div>
                      <h3 id="manual-result-title">Resultado esperado</h3>
                      <p>{activeArticle.guide.result}</p>
                    </div>
                  </section>
                </div>
              ) : activeArticle.content ? (
                <section className="manual-steps" aria-labelledby="manual-steps-title">
                  <h3 id="manual-steps-title">En esta guía</h3>
                  <ol>
                    {activeArticle.content.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </section>
              ) : (
                <section className="manual-placeholder" aria-labelledby="manual-placeholder-title">
                  <div className="manual-placeholder__icon" aria-hidden="true"><FaBookOpen /></div>
                  <div>
                    <h3 id="manual-placeholder-title">Capítulo preparado para completar</h3>
                    <p>
                      La navegación y los permisos de este tema ya están definidos. El procedimiento,
                      las comprobaciones y sus capturas se incorporarán en el bloque {activeArticle.phase}.
                    </p>
                  </div>
                </section>
              )}

              <footer className="manual-article__footer">
                <span>Última revisión de estructura: 11 de septiembre de 2026</span>
                <span>Documento operativo · Sin información sensible</span>
              </footer>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
