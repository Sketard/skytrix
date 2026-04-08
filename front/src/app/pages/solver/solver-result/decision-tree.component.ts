import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { FlatTreeControl } from '@angular/cdk/tree';
import { CdkTreeModule } from '@angular/cdk/tree';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import type { DecisionNode, SolverAction } from '../../../core/model/solver.model';
import { duelAssert } from '../../../core/utilities/duel-assert';

// =============================================================================
// Flat Tree Node
// =============================================================================

interface FlatTreeNode {
  id: number;
  node: DecisionNode;
  level: number;
  expandable: boolean;
  isMainPath: boolean;
  scoreDelta: string;
  imageUrl: string;
  isPrunedPlaceholder?: boolean;
  prunedCount?: number;
}

@Component({
  selector: 'app-decision-tree',
  standalone: true,
  imports: [CdkTreeModule, CdkConnectedOverlay, CdkOverlayOrigin, MatIconModule, MatButtonModule, MatTooltipModule, TranslatePipe],
  templateUrl: './decision-tree.component.html',
  styleUrl: './decision-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionTreeComponent {
  private readonly elementRef = inject(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  readonly tree = input.required<DecisionNode>();
  readonly mainPath = input.required<SolverAction[]>();
  readonly cardImageMap = input.required<Map<number, string>>();

  readonly treeControl = new FlatTreeControl<FlatTreeNode>(
    node => node.level,
    node => node.expandable,
  );

  readonly trackByNode = (_: number, node: FlatTreeNode) => node.id;

  readonly visibleNodes = signal<FlatTreeNode[]>([]);
  private expandedSet = new Set<DecisionNode>();

  readonly hoverNodeId = signal<number | null>(null);
  private hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly mainPathScore = computed(() => this.tree().children[0]?.score ?? this.tree().score);

  readonly isPrunedNode = (_: number, node: FlatTreeNode) => !!node.isPrunedPlaceholder;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.hoverLeaveTimer) clearTimeout(this.hoverLeaveTimer);
    });

    effect(() => {
      const root = this.tree();
      // Validate children sorted by score desc (dev-mode guard)
      if (root.children.length > 1) {
        duelAssert(
          root.children[0].score >= root.children[root.children.length - 1].score,
          'decision-tree',
          'children not sorted by score desc',
        );
      }
      this.expandedSet.clear();
      this.expandMainPath(root);
      this.rebuildVisibleNodes();
    });
  }

  toggleNode(node: FlatTreeNode): void {
    if (this.expandedSet.has(node.node)) {
      this.expandedSet.delete(node.node);
    } else {
      this.expandedSet.add(node.node);
    }
    this.rebuildVisibleNodes();
  }

  isExpanded(node: FlatTreeNode): boolean {
    return this.expandedSet.has(node.node);
  }

  scrollToAction(action: SolverAction): void {
    // Walk main-path chain (first-child recursion) to find matching node
    const root = this.tree();
    const ancestors: DecisionNode[] = [];
    let current = root;

    while (current.children.length > 0) {
      const child = current.children[0];
      ancestors.push(child);
      if (child.action && child.action.cardId === action.cardId && child.action.responseIndex === action.responseIndex) {
        break;
      }
      current = child;
    }

    // Expand all ancestors
    for (const node of ancestors) {
      if (node.children.length > 0) {
        this.expandedSet.add(node);
      }
    }
    this.rebuildVisibleNodes();

    // Find the target node id
    const targetNode = this.visibleNodes().find(
      n => !n.isPrunedPlaceholder && n.node.action?.cardId === action.cardId && n.node.action?.responseIndex === action.responseIndex && n.isMainPath,
    );
    if (!targetNode) return;

    afterNextRender(() => {
      const el = this.elementRef.nativeElement.querySelector(`[data-node-id="${targetNode.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, { injector: this.injector });
  }

  onNodeCardEnter(node: FlatTreeNode): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
    this.hoverNodeId.set(node.id);
  }

  onNodeCardLeave(): void {
    this.hoverLeaveTimer = setTimeout(() => {
      this.hoverNodeId.set(null);
      this.hoverLeaveTimer = null;
    }, 80);
  }

  onPopupEnter(): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith('card_back.jpg')) {
      img.src = 'assets/images/card_back.jpg';
    }
  }

  rebuildVisibleNodes(): void {
    this.visibleNodes.set(this.getVisibleNodes(this.tree()));
  }

  // =========================================================================
  // Private
  // =========================================================================

  private expandMainPath(root: DecisionNode): void {
    // Walk the first-child chain (main path) and expand each node
    let current = root;
    while (current.children.length > 0) {
      this.expandedSet.add(current);
      current = current.children[0]; // first child = main path
    }
  }

  private getVisibleNodes(root: DecisionNode): FlatTreeNode[] {
    const imgMap = this.cardImageMap();
    const mainScore = root.children[0]?.score ?? root.score;
    const nodes: FlatTreeNode[] = [];

    // Skip root itself — start from root.children at level 0
    for (const child of root.children) {
      this.flattenNode(child, 0, true, child === root.children[0], mainScore, imgMap, nodes);
    }

    return nodes;
  }

  private flattenNode(
    node: DecisionNode,
    level: number,
    isFirstChild: boolean,
    parentIsMainPath: boolean,
    mainScore: number,
    imgMap: Map<number, string>,
    out: FlatTreeNode[],
  ): void {
    const isMainPath = parentIsMainPath && isFirstChild;
    const expandable = node.children.length > 0;

    // Score delta: only for level 0 non-main-path nodes (root alternatives)
    let scoreDelta = '';
    if (level === 0 && !isMainPath) {
      const delta = node.score - mainScore;
      scoreDelta = delta >= 0 ? `+${delta}` : `${delta} vs main`;
    }

    const flatNode: FlatTreeNode = {
      id: out.length,
      node,
      level,
      expandable,
      isMainPath,
      scoreDelta,
      imageUrl: imgMap.get(node.action?.cardId) ?? 'assets/images/card_back.jpg',
    };
    out.push(flatNode);

    // Only descend if expanded
    if (expandable && this.expandedSet.has(node)) {
      for (let i = 0; i < node.children.length; i++) {
        this.flattenNode(node.children[i], level + 1, i === 0, isMainPath, mainScore, imgMap, out);
      }

      // Pruned placeholder
      if (node.prunedChildren && node.prunedChildren > 0) {
        out.push({
          id: out.length,
          node, // parent reference (not rendered)
          level: level + 1,
          expandable: false,
          isMainPath: false,
          scoreDelta: '',
          imageUrl: '',
          isPrunedPlaceholder: true,
          prunedCount: node.prunedChildren,
        });
      }
    }
  }
}
