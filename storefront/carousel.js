(() => {
  const gallery = document.querySelector("[data-hero-carousel]");
  if (!gallery || !("IntersectionObserver" in window)) return;
  const hero = gallery.closest(".catalog-hero");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current = gallery.querySelector("picture");
  const slides = [
    [current.querySelector("img").getAttribute("src"), current.querySelector("source").getAttribute("srcset"), current.querySelector("img").alt],
    ["images/round-marble-dining-set.jpg", "storefront/round-marble-dining-set-mobile.webp", "Round marble dining set"],
    ["images/executive-office-desk-wide.jpg", "storefront/executive-office-desk-wide-mobile.webp", "Executive office desk"],
    ["images/tv-console-bright-mountain.jpg", "storefront/tv-console-bright-mountain-mobile.webp", "Modern TV console in a bright living room"],
    ["images/gunmetal-shower-set-clean.webp", "storefront/gunmetal-shower-set-clean-mobile.webp", "Gunmetal rainfall shower set"]
  ];
  let slide = 0;
  let timer;
  let inView = false;
  let pointerInside = false;
  let loading = false;

  const canRotate = () => inView && !document.hidden && !reducedMotion.matches &&
    !pointerInside && !hero.contains(document.activeElement);

  function schedule() {
    clearTimeout(timer);
    if (!loading && canRotate()) timer = setTimeout(advance, 2000);
  }

  async function advance() {
    if (!canRotate()) return;
    loading = true;
    const nextIndex = (slide + 1) % slides.length;
    const [desktop, mobile, alt] = slides[nextIndex];
    const next = document.createElement("picture");
    next.dataset.nextFrame = "";
    next.setAttribute("aria-hidden", "true");
    const source = document.createElement("source");
    source.media = "(max-width: 680px)";
    source.srcset = mobile;
    const image = document.createElement("img");
    image.className = "catalog-hero-image";
    image.alt = alt;
    next.append(source, image);
    gallery.append(next);
    image.src = desktop;
    try {
      await image.decode();
      if (canRotate()) {
        current.remove();
        next.removeAttribute("data-next-frame");
        next.removeAttribute("aria-hidden");
        next.classList.add("catalog-hero-fade");
        current = next;
        slide = nextIndex;
      }
    } catch {
      // Keep the visible photo if this image cannot be loaded.
      slide = nextIndex;
    } finally {
      if (next !== current) next.remove();
      loading = false;
      schedule();
    }
  }

  new IntersectionObserver(([entry]) => {
    inView = entry.intersectionRatio >= 0.2;
    schedule();
  }, { threshold: 0.2 }).observe(gallery);
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", schedule);
  hero.addEventListener("focusin", schedule);
  hero.addEventListener("focusout", () => setTimeout(schedule, 0));
  gallery.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse") return;
    pointerInside = true;
    schedule();
  });
  gallery.addEventListener("pointerleave", () => {
    pointerInside = false;
    schedule();
  });
})();
