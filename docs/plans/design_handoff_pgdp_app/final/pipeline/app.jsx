// app.jsx — Pipeline page template demo. Two locked templates published
// here: PipelineTemplate (per-stage tab slot + content slot) and
// ProjectSettingsTemplate (project-scoped destination). Stage-specific
// wired-up canvases live in sibling folders (../source/, ../crop/, …).

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 940;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="pipeline" />
      <DesignCanvas
        title="2 · Pipeline page — templates"
        subtitle="The two locked templates: PipelineTemplate (per-stage tab slot + content slot) and ProjectSettingsTemplate (project-scoped settings destination). Wired-up stage canvases live in sibling pages — see the top-left switcher."
        sectionGap={64}
      >
        <DCSection
          id="P"
          title="P · Pipeline template — empty slots"
          subtitle="Drop content into the children slot; override tabsSlot to take full control of the tab band."
        >
          <DCArtboard id="P1" label="1 · Pipeline template · threshold (default tabs)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" />
          </DCArtboard>
          <DCArtboard id="P3" label="2 · Pipeline template · text_review (Review queue + Comments)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="queue" />
          </DCArtboard>
          <DCArtboard id="P4" label="3 · Pipeline template · build_package (Manifest + Pre-flight)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="build_package" currentTab="manifest" />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="S"
          title="S · Project settings template — every group laid out"
          subtitle="Reached from the Project settings toggle in the info band. Sub-nav is a left rail; right pane is per-group content. Stage defaults is the new core concept — per-project per-stage defaults backed by a preset library."
        >
          <DCArtboard id="S1" label="1 · General · name / ID / location / automation" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="general" />
          </DCArtboard>
          <DCArtboard id="S2" label="2 · Bibliographic · book metadata (moved from Source tab)" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="bib">
              <ProjectSettings_Bibliographic />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S3" label="3 · PGDP submission · project ID / round / submission settings" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="pgdp">
              <ProjectSettings_PGDP />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S4" label="4 · Format & content · page format, illustrations, footnotes" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="format">
              <ProjectSettings_Format />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S5" label="5 · Stage defaults · per-stage defaults + preset library (KEY)" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="defaults">
              <ProjectSettings_StageDefaults selectedStage="source" />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S6" label="6 · Members · single-user v1" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="members">
              <ProjectSettings_Members />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S7" label="7 · Storage & cleanup · disk usage by stage + cleanup actions" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="storage">
              <ProjectSettings_Storage />
            </ProjectSettingsTemplate>
          </DCArtboard>
          <DCArtboard id="S8" label="8 · Danger zone · delete + reset" width={W} height={H}>
            <ProjectSettingsTemplate theme={theme} currentGroup="danger">
              <ProjectSettings_Danger />
            </ProjectSettingsTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
