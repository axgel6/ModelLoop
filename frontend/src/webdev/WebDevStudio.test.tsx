import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WebDevContext, withLiveFiles, type StudioProject } from "./context";
import { ProjectCard, WebDevStudio } from "./WebDevStudio";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q }) as MediaQueryList);
  Element.prototype.scrollTo ??= () => {};
});

const project: StudioProject = {
  name: "Crumb Bakery",
  version: 2,
  files: [
    { path: "index.html", content: '<link rel="stylesheet" href="style.css"><h1>Crumb</h1>' },
    { path: "style.css", content: "h1 { color: brown; }" },
  ],
  versions: [
    { version: 2, label: "Make the heading brown", when: "Just now" },
    { version: 1, label: "A landing page for a bakery", when: "4 min ago" },
  ],
  lastChanges: [{ action: "edited", path: "style.css" }],
};

const props = {
  project,
  messages: [],
  busy: false,
  activity: null,
  onSend: () => {},
  onClose: () => {},
};

const frame = () => screen.getByTitle("Site preview") as HTMLIFrameElement;

describe("WebDevStudio", () => {
  it("previews the project's files with the stylesheet inline", () => {
    render(<WebDevStudio {...props} />);
    expect(screen.getByText("Crumb Bakery")).toBeTruthy();
    expect(frame().srcdoc).toContain("h1 { color: brown; }");
  });

  it("opens the code drawer on the file it was given", () => {
    render(<WebDevStudio {...props} initialPath="style.css" />);
    const code = screen.getByLabelText("style.css") as HTMLTextAreaElement;
    expect(code.value).toBe("h1 { color: brown; }");
    expect(code.readOnly).toBe(true);
  });

  it("shows an older version and goes back to the latest", async () => {
    const loadVersion = vi.fn(async () => [{ path: "index.html", content: "<h1>First</h1>" }]);
    render(<WebDevStudio {...props} loadVersion={loadVersion} />);
    fireEvent.click(screen.getByRole("button", { name: /v2/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /v1/ }));
    });
    expect(loadVersion).toHaveBeenCalledWith(1);
    expect(frame().srcdoc).toBe("<h1>First</h1>");
    fireEvent.click(screen.getByText("Back to latest"));
    expect(frame().srcdoc).toContain("Crumb");
  });

  it("follows a new version from the chat", () => {
    const { rerender } = render(<WebDevStudio {...props} />);
    rerender(
      <WebDevStudio
        {...props}
        project={{ ...project, version: 3, files: [{ path: "index.html", content: "<h1>Third</h1>" }] }}
      />,
    );
    expect(frame().srcdoc).toContain("<h1>Third</h1>");
  });

  it("sends a change, and offers stop while the reply is written", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<WebDevStudio {...props} onSend={onSend} onStop={onStop} />);
    fireEvent.change(screen.getByLabelText("Describe a change"), { target: { value: "Add a menu" } });
    fireEvent.submit(screen.getByLabelText("Describe a change").closest("form")!);
    expect(onSend).toHaveBeenCalledWith("Add a menu");

    rerender(
      <WebDevStudio
        {...props}
        busy
        activity="Editing the code"
        onStop={onStop}
        messages={[
          { role: "user", text: "Add a menu" },
          { role: "assistant", text: "" },
        ]}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Editing the code");
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("opens a changed file from its label", () => {
    render(
      <WebDevStudio
        {...props}
        messages={[{ role: "assistant", text: "Done.", changes: [{ action: "edited", path: "style.css" }], version: 2 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edited style.css" }));
    expect((screen.getByLabelText("style.css") as HTMLTextAreaElement).value).toContain("brown");
  });
});

describe("Fix it", () => {
  const report = (text: string) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { wdPreview: 1, text }, source: frame().contentWindow }),
      );
    });

  it("shows the preview's errors and sends them to the model", () => {
    const onSend = vi.fn();
    render(<WebDevStudio {...props} onSend={onSend} />);
    expect(frame().srcdoc).toContain("wdPreview");
    report("x is not defined (app.js line 3)");
    report("x is not defined (app.js line 3)");
    expect(screen.getByRole("alert").textContent).toContain("x is not defined (app.js line 3)");
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
    expect(onSend).toHaveBeenCalledWith("The preview shows an error. Please fix it.\n\n- x is not defined (app.js line 3)");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores messages from anywhere but the preview", () => {
    render(<WebDevStudio {...props} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { wdPreview: 1, text: "spoofed" }, source: window }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error when the preview reloads", () => {
    render(<WebDevStudio {...props} />);
    report("boom");
    fireEvent.click(screen.getByLabelText("Reload preview"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Restore", () => {
  it("restores the version being viewed", async () => {
    const loadVersion = vi.fn(async () => [{ path: "index.html", content: "<h1>First</h1>" }]);
    const onRestore = vi.fn(async () => {});
    const { rerender } = render(<WebDevStudio {...props} loadVersion={loadVersion} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole("button", { name: /v2/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /v1/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    });
    expect(onRestore).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: "Restoring" })).toBeTruthy();
    rerender(
      <WebDevStudio
        {...props}
        loadVersion={loadVersion}
        onRestore={onRestore}
        project={{ ...project, version: 3, files: [{ path: "index.html", content: "<h1>First</h1>" }] }}
      />,
    );
    expect(screen.queryByText("Back to latest")).toBeNull();
    expect(frame().srcdoc).toContain("<h1>First</h1>");
  });
});

describe("ProjectCard", () => {
  it("shows the project and opens the studio", () => {
    const open = vi.fn();
    render(
      <WebDevContext.Provider value={{ project, open }}>
        <ProjectCard />
      </WebDevContext.Provider>,
    );
    expect(screen.getByText("v2 · 2 files · Edited style.css")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Crumb Bakery in the studio" }));
    expect(open).toHaveBeenCalled();
  });

  it("is absent until the project loads", () => {
    const { container } = render(
      <WebDevContext.Provider value={{ project: null, open: () => {} }}>
        <ProjectCard />
      </WebDevContext.Provider>,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("ProjectSteps in the studio", () => {
  it("lists finished steps and times the one in progress", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:00:42Z"));
    render(
      <WebDevStudio
        {...props}
        busy
        messages={[
          { role: "user", text: "Build it" },
          {
            role: "assistant",
            text: "",
            createdAt: "2026-11-08T12:00:00Z",
            steps: [
              { verb: "created", path: "index.html" },
            ],
          },
        ]}
      />,
    );
    const items = [...screen.getByLabelText("Progress").querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Created index.html", "Working on the next step0:42"]);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status").textContent).toContain("0:44");
    vi.useRealTimers();
  });

  it("names the plan and the checks", () => {
    render(
      <WebDevStudio
        {...props}
        busy
        messages={[
          { role: "user", text: "Develop a snake game" },
          {
            role: "assistant",
            text: "",
            steps: [
              { verb: "planned", path: null },
              { verb: "created", path: "app.js" },
              { verb: "checked", path: null, count: 2 },
              { verb: "edited", path: "app.js" },
              { verb: "checked", path: null, count: 0 },
            ],
          },
        ]}
      />,
    );
    const items = [...screen.getByLabelText("Progress").querySelectorAll("li")].map((li) => li.textContent);
    expect(items.slice(0, 5)).toEqual([
      "Planned the site",
      "Created app.js",
      "Found 2 problems to fix",
      "Edited app.js",
      "Checked the site",
    ]);
  });
});

describe("Code colors", () => {
  it("switches the drawer between auto, light and dark, and remembers it", () => {
    localStorage.removeItem("wd_code_theme");
    const { container, unmount } = render(<WebDevStudio {...props} initialPath="index.html" />);
    const body = () => container.querySelector(".wd-code-body")!;
    expect(body().getAttribute("data-code")).toBe("auto");
    fireEvent.click(screen.getByRole("radio", { name: "Light code" }));
    expect(body().getAttribute("data-code")).toBe("light");
    unmount();
    const again = render(<WebDevStudio {...props} initialPath="index.html" />);
    expect(again.container.querySelector(".wd-code-body")!.getAttribute("data-code")).toBe("light");
  });
});

describe("withLiveFiles", () => {
  it("puts a running turn's changes over the saved files", () => {
    const merged = withLiveFiles(project.files, { "style.css": null, "app.js": "go()", "index.html": "<h1>New</h1>" });
    expect(merged).toEqual([
      { path: "app.js", content: "go()" },
      { path: "index.html", content: "<h1>New</h1>" },
    ]);
  });
});
