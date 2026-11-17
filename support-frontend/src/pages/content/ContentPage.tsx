import { useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../auth/context';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui';
import { ArticlesTab } from './ArticlesTab';
import { GuidesTab } from './GuidesTab';
import { TemplatesTab } from './TemplatesTab';

type Tab = 'articles' | 'reponses' | 'parcours';

/** Knowledge base articles, ready-made replies and guided paths (member "Aide" content). */
export default function ContentPage() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const canArticles = perms.has('kb.edit') || perms.has('kb.publish');
  const tabs: { value: Tab; label: string }[] = [
    ...(canArticles ? [{ value: 'articles' as const, label: 'Articles' }] : []),
    { value: 'reponses', label: 'Réponses prêtes' },
    { value: 'parcours', label: 'Parcours guidés' },
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some(t => t.value === asked) ? (asked as Tab) : tabs[0].value;

  return (
    <>
      <PageHeader title="Contenus" description="Ce que les membres lisent dans l’espace Aide, et les réponses prêtes des agents." />
      <Tabs value={tab} onValueChange={v => setParams({ tab: v }, { replace: true })}>
        <TabsList aria-label="Contenus">
          {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
        {canArticles && <TabsContent value="articles" className="pt-5"><ArticlesTab /></TabsContent>}
        <TabsContent value="reponses" className="pt-5"><TemplatesTab /></TabsContent>
        <TabsContent value="parcours" className="pt-5"><GuidesTab /></TabsContent>
      </Tabs>
    </>
  );
}
