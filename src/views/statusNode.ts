import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository, RepositoryFileSystemChangeEvent } from '../gitService';
import { StatusFilesNode } from './statusFilesNode';
import { StatusUpstreamNode } from './statusUpstreamNode';

export class StatusNode extends ExplorerNode {

    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer,
        private readonly active: boolean = false
    ) {
        super(uri);
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path})${this.active ? ':active' : ''}:status`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        const status = await this.repo.getStatus();
        if (status === undefined) return [];

        this.children = [];

        if (status.state.behind) {
            this.children.push(new StatusUpstreamNode(status, 'behind', this.explorer, this.active));
        }

        if (status.state.ahead) {
            this.children.push(new StatusUpstreamNode(status, 'ahead', this.explorer, this.active));
        }

        if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
            const range = status.upstream
                ? `${status.upstream}..${status.branch}`
                : undefined;
            this.children.push(new StatusFilesNode(status, range, this.explorer, this.active));
        }

        return this.children;
    }

    async getTreeItem(): Promise < TreeItem > {
        if (this.disposable !== undefined) {
            this.disposable.dispose();
            this.disposable = undefined;
        }

        const status = await this.repo.getStatus();
        if (status === undefined) return new TreeItem('No repo status');

        if (this.explorer.autoRefresh && this.includeWorkingTree) {
            this.disposable = Disposable.from(
                this.explorer.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this),
                this.repo.onDidChangeFileSystem(this.onFileSystemChanged, this),
                { dispose: () => this.repo.stopWatchingFileSystem() }
            );

            this.repo.startWatchingFileSystem();
        }

        let hasChildren = false;
        const hasWorkingChanges = status.files.length !== 0 && this.includeWorkingTree;
        let label = `${status.getUpstreamStatus({ prefix: `${GlyphChars.Space} ` })}${hasWorkingChanges ? status.getDiffStatus({ prefix: `${GlyphChars.Space} `}) : ''}`;
        let tooltip = `${status.branch} (current)`;
        let iconSuffix = '';

        if (status.upstream) {
            if (this.explorer.config.showTrackingBranch) {
                label += `${GlyphChars.Space} ${status.upstream}`;
            }
            tooltip += `\n\nTracking ${GlyphChars.Dash} ${status.upstream}\n${status.getUpstreamStatus({ empty: 'up-to-date', expand: true, separator: '\n' })}`;

            if (status.state.ahead || status.state.behind) {
                hasChildren = true;

                if (status.state.behind) {
                    iconSuffix = '-red';
                }
                if (status.state.ahead) {
                    iconSuffix = status.state.behind ? '-yellow' : '-green';
                }
            }
        }

        label = `${status.branch}${label === '' ? '' : ` ${GlyphChars.Space}${status.upstream ? GlyphChars.ArrowLeftRightLong : GlyphChars.Dash}${label}`}`;
        if (hasWorkingChanges) {
            tooltip += `\n\nHas uncommitted changes${status.getDiffStatus({ expand: true, prefix: `\n`, separator: '\n' })}`;
        }

        let state: TreeItemCollapsibleState;
        if (hasChildren || hasWorkingChanges) {
            // HACK: Until https://github.com/Microsoft/vscode/issues/30918 is fixed
            state = this.active ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
        }
        else {
            state = TreeItemCollapsibleState.None;
        }

        const item = new TreeItem(label, state);
        item.id = this.id;
        item.contextValue = ResourceType.Status;
        item.tooltip = tooltip;
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.explorer.config.includeWorkingTree;
    }

    private onAutoRefreshChanged() {
        if (this.disposable === undefined) return;

        // If auto-refresh changes, just kill the subscriptions
        // (if it was enabled -- we will get refreshed so we don't have to worry about re-hooking it up here)
        this.disposable.dispose();
        this.disposable = undefined;
    }

    private async onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        this.explorer.refreshNode(this);
    }
}