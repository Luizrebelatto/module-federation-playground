export const CONTRACT_VERSION = "1.0.0";

export type Todo = { id: string; title: string; completed: boolean };

export interface TodoStore {
    getSnapshot(): readonly Todo[];
    subscribe(listener: () => void): () => void;
    add(title: string): Promise<void>;
    toggle(id: string): Promise<void>;
    remove(id: string): Promise<void>;
}

export type TodoRemoteProps = { store: TodoStore; releaseId: string }