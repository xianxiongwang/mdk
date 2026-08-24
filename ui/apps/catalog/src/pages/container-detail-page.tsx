import { ContainerDetail, ContainerDetailPlaceholder } from '@tetherto/mdk-react-devkit/domain'
import { CONTAINER_TAB_LABEL } from '@tetherto/mdk-ui-foundation'
import { getSupportedContainerTabs } from '@tetherto/mdk-ui-foundation/presets/mining'
import { type JSX, useState } from 'react'

import { DemoBlock } from '../components/demo-block'
import { DemoPageHeader } from '../components/demo-page-header'

// Synthetic container types only — no real device names or sites. The tab set
// is resolved from the shared tab matrix exactly as the shell page does, so the
// demo mirrors production per-model behaviour (Bitdeer-M56 gets Power Adjustment;
// hydro gets Alarm).
const tabsFor = (type: string) =>
  getSupportedContainerTabs(type).map((key) => ({ key, label: CONTAINER_TAB_LABEL[key] }))

const BITDEER_M56 = 'container-bd-d40-m56'
const HYDRO = 'container-as-hk3'

const ContainerDetailScenario = ({
  name,
  type,
}: {
  name: string
  type: string
}): JSX.Element => {
  const tabs = tabsFor(type)
  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? '')
  const activeLabel = tabs.find((t) => t.key === activeTab)?.label ?? activeTab

  return (
    <ContainerDetail
      name={name}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onBack={() => {}}
      backLabel="Explorer"
    >
      <ContainerDetailPlaceholder label={activeLabel} />
    </ContainerDetail>
  )
}

export const ContainerDetailPage = (): JSX.Element => (
  <div>
    <DemoPageHeader
      title="Container Detail"
      description="Explorer → container detail: the full-page tabbed shell behind /explorer/containers/:id/:tab. A back link, the container name, and a per-model tab strip resolved from the shared tab matrix. Purely presentational — the shell page owns routing and feeds the resolved tabs + active tab; each tab's body is supplied as children (here a placeholder until the real tab lands)."
    />

    <DemoBlock
      title="Whatsminer container (Bitdeer-M56)"
      description="Home · PDU Layout · Power Adjustment · Settings · Charts · Heatmap — Power Adjustment appears because it's a Whatsminer container. Switch tabs to see the active body update."
    >
      <ContainerDetailScenario name="Container 2a" type={BITDEER_M56} />
    </DemoBlock>

    <DemoBlock
      title="Hydro container"
      description="Same shell, different matrix — hydro/immersion models get an Alarm tab instead of Power Adjustment."
    >
      <ContainerDetailScenario name="Container 4b" type={HYDRO} />
    </DemoBlock>

    <DemoBlock
      title="Unknown / unsupported type"
      description="When the tab matrix returns no tabs, the shell shows an empty state instead of the tab strip."
    >
      <ContainerDetail
        name="Container ??"
        tabs={[]}
        activeTab=""
        onTabChange={() => {}}
        onBack={() => {}}
      />
    </DemoBlock>
  </div>
)
