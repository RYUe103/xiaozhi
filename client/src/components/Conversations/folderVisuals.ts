import { Folder, Layers, Bookmark, Star, BriefcaseBusiness } from 'lucide-react';

export const colorChoices = ['#d1a934', '#8b8d91', '#5b8def', '#24a148', '#e05a47', '#7c5cff'];

export const folderIconChoices = [
  { value: 'folder', label: '文件夹', Icon: Folder },
  { value: 'layers', label: '项目', Icon: Layers },
  { value: 'bookmark', label: '书签', Icon: Bookmark },
  { value: 'star', label: '星标', Icon: Star },
  { value: 'briefcase', label: '工作', Icon: BriefcaseBusiness },
];

export const getFolderIcon = (value?: string) =>
  folderIconChoices.find((choice) => choice.value === value)?.Icon ?? Folder;
