export enum Theme {
    Light = 'light',
    Dark = 'dark',
}

export type ThemeConfig = {
    className: string;
    icon: string;
};

export const THEME_CONFIG: Record<Theme, ThemeConfig> = {
    [Theme.Light]: {
        className: 'light',
        icon: '🌞',
    },
    [Theme.Dark]: {
        className: 'dark',
        icon: '🌜',
    },
};