<script lang="ts">
	import { page } from '$app/state';
	import { Doc } from '@ogygia/content';
	import * as docs from '$lib/docs.remote';

	let { data } = $props();

	const view = $derived((await docs.page(page.params.slug ?? ''))!);
	const edit = $derived(
		`https://github.com/PuruVJ/neosanitize/edit/main/docs/src/content/docs/${data.file}`,
	);
</script>

<Doc {view}>
	{#snippet footer()}
		<div class="ns-doc-footer">
			<a class="ns-edit" href={edit} target="_blank" rel="noreferrer">Edit this page on GitHub</a>
		</div>
	{/snippet}
</Doc>
