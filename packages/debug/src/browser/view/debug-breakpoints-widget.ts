/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import {
    VirtualWidget, SELECTED_CLASS, AbstractDialog, Widget, Message,
} from '@theia/core/lib/browser';
import { DebugSession } from '../debug-model';
import { h } from '@phosphor/virtualdom';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Emitter, Event, DisposableCollection } from '@theia/core';
import { injectable, inject, postConstruct } from 'inversify';
import { BreakpointsManager } from '../breakpoint/breakpoint-manager';
import { ExtDebugProtocol } from '../../common/debug-common';
import { DebugUtils } from '../debug-utils';
import { Disposable } from '@theia/core';
import { DebugStyles, DebugWidget, DebugContext } from './debug-view-common';

/**
 * Is it used to display breakpoints.
 */
@injectable()
export class DebugBreakpointsWidget extends VirtualWidget implements DebugWidget {
    private _debugContext: DebugContext | undefined;
    private readonly onDidClickBreakpointEmitter = new Emitter<ExtDebugProtocol.AggregatedBreakpoint>();
    private readonly onDidDblClickBreakpointEmitter = new Emitter<ExtDebugProtocol.AggregatedBreakpoint>();
    private readonly sessionDisposableEntries = new DisposableCollection();
    private breakpoints: ExtDebugProtocol.AggregatedBreakpoint[] = [];

    constructor(@inject(BreakpointsManager) protected readonly breakpointManager: BreakpointsManager) {
        super();

        this.addClass('theia-debug-entry');
        this.node.setAttribute('tabIndex', '0');
        this.id = this.createId();
    }

    @postConstruct()
    protected init() {
        this.toDispose.push(this.breakpointManager.onDidChangeBreakpoints(() => this.refreshBreakpoints()));
    }

    dispose(): void {
        this.sessionDisposableEntries.dispose();
        super.dispose();
    }

    get debugContext(): DebugContext | undefined {
        return this._debugContext;
    }

    set debugContext(debugContext: DebugContext | undefined) {
        this.sessionDisposableEntries.dispose();
        this._debugContext = debugContext;
        this.id = this.createId();

        if (this.debugSession) {
            const configurationDoneListener = () => this.refreshBreakpoints();
            const terminatedEventListener = (event: DebugProtocol.TerminatedEvent) => this.onTerminatedEvent(event);

            this.debugSession.on('configurationDone', configurationDoneListener);
            this.debugSession.on('terminated', terminatedEventListener);

            this.sessionDisposableEntries.push(Disposable.create(() => this.debugSession!.removeListener('configurationDone', configurationDoneListener)));
            this.sessionDisposableEntries.push(Disposable.create(() => this.debugSession!.removeListener('terminated', terminatedEventListener)));
        }

        this.refreshBreakpoints();
    }

    get onDidClickBreakpoint(): Event<ExtDebugProtocol.AggregatedBreakpoint> {
        return this.onDidClickBreakpointEmitter.event;
    }

    get onDidDblClickBreakpoint(): Event<ExtDebugProtocol.AggregatedBreakpoint> {
        return this.onDidDblClickBreakpointEmitter.event;
    }

    async refreshBreakpoints(): Promise<void> {
        if (this.debugSession) {
            this.breakpoints = await this.breakpointManager.get(this.debugSession.sessionId);
        } else {
            this.breakpoints = await this.breakpointManager.getAll();
        }
        this.breakpoints.sort();

        super.update();
    }

    protected render(): h.Child {
        const header = h.div({ className: 'theia-debug-header' }, 'Breakpoints');
        const items: h.Child = [];

        for (const breakpoint of this.breakpoints) {
            const item =
                h.div({
                    id: DebugUtils.makeBreakpointId(breakpoint),
                    className: DebugStyles.DEBUG_ITEM,
                    onclick: event => {
                        const selected = this.node.getElementsByClassName(SELECTED_CLASS)[0];
                        if (selected) {
                            selected.className = DebugStyles.DEBUG_ITEM;
                        }
                        (event.target as HTMLDivElement).className = `${DebugStyles.DEBUG_ITEM} ${SELECTED_CLASS}`;

                        this.onDidClickBreakpointEmitter.fire(breakpoint);
                    },
                    ondblclick: () => this.onDidDblClickBreakpointEmitter.fire(breakpoint),
                }, this.toDisplayName(breakpoint));
            items.push(item);
        }

        return [header, h.div({ className: Styles.BREAKPOINTS }, items)];
    }

    protected onTerminatedEvent(event: DebugProtocol.TerminatedEvent): void { }

    private toDisplayName(breakpoint: ExtDebugProtocol.AggregatedBreakpoint): string {
        if ('origin' in breakpoint) {
            if (DebugUtils.isSourceBreakpoint(breakpoint)) {
                return this.toDisplayNameSourceBrk(breakpoint.source!, breakpoint.origin as DebugProtocol.SourceBreakpoint);

            } else if (DebugUtils.isFunctionBreakpoint(breakpoint)) {
                return (breakpoint.origin as DebugProtocol.FunctionBreakpoint).name;

            } else if (DebugUtils.isExceptionBreakpoint(breakpoint)) {
                return (breakpoint.origin as ExtDebugProtocol.ExceptionBreakpoint).filter;
            }
        }

        throw new Error('Unrecognized breakpoint type: ' + JSON.stringify(breakpoint));
    }

    private toDisplayNameSourceBrk(source: DebugProtocol.Source, breakpoint: DebugProtocol.SourceBreakpoint): string {
        return source.name! + `:${breakpoint.line}` + (breakpoint.column ? `:${breakpoint.column}` : '');
    }

    private get debugSession(): DebugSession | undefined {
        return this._debugContext && this._debugContext.debugSession;
    }

    private createId() {
        return 'debug-breakpoints' + (this.debugSession ? `-${this.debugSession.sessionId}` : '');
    }
}

@injectable()
export class BreakpointsDialog extends AbstractDialog<void> {
    private readonly breakpointsWidget: DebugBreakpointsWidget;

    constructor(@inject(BreakpointsManager) protected readonly breakpointManager: BreakpointsManager) {
        super({
            title: 'Breakpoints'
        });

        this.breakpointsWidget = new DebugBreakpointsWidget(breakpointManager);
        this.breakpointsWidget.addClass(Styles.BREAKPOINT_DIALOG);
        this.toDispose.push(this.breakpointsWidget);
    }

    @postConstruct()
    protected init() {
        this.appendCloseButton('Close');
    }

    protected onAfterAttach(msg: Message): void {
        Widget.attach(this.breakpointsWidget, this.contentNode);
        super.onAfterAttach(msg);
    }

    protected onBeforeDetach(msg: Message): void {
        super.onBeforeDetach(msg);
        Widget.detach(this.breakpointsWidget);
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.breakpointsWidget.update();
    }

    protected onActivateRequest(msg: Message): void {
        this.breakpointsWidget.activate();
    }

    open(): Promise<void> {
        this.breakpointsWidget.refreshBreakpoints();
        return super.open();
    }

    get value(): void { return undefined; }
}

namespace Styles {
    export const BREAKPOINTS = 'theia-debug-breakpoints';
    export const BREAKPOINT_DIALOG = 'theia-debug-breakpoint-dialog';
}
