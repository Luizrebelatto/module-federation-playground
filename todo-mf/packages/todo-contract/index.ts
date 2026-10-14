export const CONTRACT_VERSION = "1.0.0";

export type Todo = { id: string; title: string; completed: boolean };

export interface TodoStore {
    getSnapshot(): Todo[]
    subscribe(listener: () => void): () => void;
    add(title: string): Promise<void>;
    toggle(title: string): Promise<void>;
    remove(title: string): Promise<void>;
}

export type TodoRemoteProps = { store: TodoStore; releaseId: string }