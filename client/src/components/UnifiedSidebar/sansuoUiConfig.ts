import {
  Blocks,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  FileText,
  Globe,
  Link2,
  Megaphone,
  Wrench,
} from 'lucide-react';

export type SanSuoAppLinkNotice = {
  title?: string;
  body?: string;
  imageUrl?: string;
  confirmLabel?: string;
};

export type SanSuoAppLink = {
  id: string;
  label: string;
  url?: string;
  icon?: string;
  enabled?: boolean;
  allowedUserIds?: string[];
  entryNotice?: SanSuoAppLinkNotice;
};

export type SanSuoUiConfig = {
  appLinks?: SanSuoAppLink[];
  announcement?: {
    title?: string;
    body?: string;
    imageUrl?: string;
    showOnLogin?: boolean;
    updatedAt?: string;
  };
  knowledgeSources?: {
    knowledgeLabel?: string;
    materialsLabel?: string;
    materialPromptTemplate?: string;
  };
};

export const sansuoAppIconOptions = [
  { value: 'blocks', label: '默认', Icon: Blocks },
  { value: 'building', label: '企业', Icon: Building2 },
  { value: 'briefcase', label: '工作', Icon: BriefcaseBusiness },
  { value: 'book', label: '知识库', Icon: BookOpen },
  { value: 'document', label: '文档', Icon: FileText },
  { value: 'tool', label: '工具', Icon: Wrench },
  { value: 'globe', label: '网站', Icon: Globe },
  { value: 'link', label: '链接', Icon: Link2 },
  { value: 'notice', label: '公告', Icon: Megaphone },
];

export const getSansuoAppIcon = (value?: string) =>
  sansuoAppIconOptions.find((option) => option.value === value)?.Icon ?? Blocks;

export const createEmptyAppLink = (): SanSuoAppLink => ({
  id: `link-${Date.now().toString(36)}`,
  label: '',
  url: '',
  icon: 'blocks',
  enabled: true,
});
