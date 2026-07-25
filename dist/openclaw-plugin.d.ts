declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        parse: () => {};
    };
    register(api: any): void;
};
export default plugin;
//# sourceMappingURL=openclaw-plugin.d.ts.map