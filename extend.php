<?php

use Flarum\Extend;
use Hooey\RepairForm\Api\Controllers\RepairStatusController;
use Hooey\RepairForm\Api\Controllers\RepairsController;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js')
        ->route('/repair', 'hooey.repair')
        ->route('/repairs', 'hooey.repairs'),

    (new Extend\Routes('api'))
        ->get('/hooey/repairs', 'hooey.repairs', RepairsController::class)
        ->post('/hooey/repairs/{id}/status', 'hooey.repairs.status', RepairStatusController::class),
];
